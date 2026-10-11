#include "wifi_receiver.h"
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <wincrypt.h>
#include <wininet.h>
#include <shlobj.h>

#include <wincodec.h>
#include <chrono>
#include <cstring>
#include <string>
#include <vector>
#include <iostream>
#include <obs-module.h>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "crypt32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "wininet.lib")
#pragma comment(lib, "windowscodecs.lib")
#pragma comment(lib, "ole32.lib")

namespace dexcam {

// ── Helpers ──────────────────────────────────────────────────────────────────
static uint64_t mono_us()
{
    LARGE_INTEGER freq, cnt;
    QueryPerformanceFrequency(&freq);
    QueryPerformanceCounter(&cnt);
    return static_cast<uint64_t>(cnt.QuadPart * 1'000'000ULL / freq.QuadPart);
}

static std::string calculate_websocket_accept(const std::string& key)
{
    std::string magic = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    HCRYPTPROV hProv = 0;
    std::string accept_b64;

    if (CryptAcquireContextA(&hProv, NULL, NULL, PROV_RSA_FULL, CRYPT_VERIFYCONTEXT)) {
        HCRYPTHASH hHash = 0;
        if (CryptCreateHash(hProv, CALG_SHA1, 0, 0, &hHash)) {
            if (CryptHashData(hHash, (const BYTE*)magic.data(), (DWORD)magic.size(), 0)) {
                BYTE hash[20];
                DWORD hashLen = sizeof(hash);
                if (CryptGetHashParam(hHash, HP_HASHVAL, hash, &hashLen, 0)) {
                    char b64[64] = {0};
                    DWORD b64Len = sizeof(b64);
                    if (CryptBinaryToStringA(hash, hashLen, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, b64, &b64Len)) {
                        accept_b64 = b64;
                    }
                }
            }
            CryptDestroyHash(hHash);
        }
        CryptReleaseContext(hProv, 0);
    }
    return accept_b64;
}

static bool recv_all(SOCKET s, uint8_t* buf, size_t total_len)
{
    size_t received = 0;
    while (received < total_len) {
        int n = recv(s, (char*)buf + received, (int)(total_len - received), 0);
        if (n <= 0) return false;
        received += n;
    }
    return true;
}

// ── Construction / destruction ────────────────────────────────────────────────
WifiReceiver::WifiReceiver(std::shared_ptr<FrameQueue> queue)
    : m_queue(std::move(queue))
{
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
}

WifiReceiver::~WifiReceiver()
{
    stop();
    WSACleanup();
}

bool WifiReceiver::start(const ReceiverConfig& config,
                         StateChangeCb         state_cb,
                         ErrorCb               error_cb)
{
    if (m_worker.joinable()) {
        return false;
    }

    m_stop_flag.store(false, std::memory_order_release);
    m_state.store(ConnectionState::CONNECTING, std::memory_order_release);
    if (state_cb) state_cb(ConnectionState::CONNECTING, "Starting frame bridge");

    m_worker = std::thread(&WifiReceiver::worker_main, this,
                           config, std::move(state_cb), std::move(error_cb));
    return true;
}

void WifiReceiver::stop()
{
    m_stop_flag.store(true, std::memory_order_release);

    if (m_stream_socket != ~0ULL) {
        closesocket((SOCKET)m_stream_socket);
        m_stream_socket = ~0ULL;
    }

    if (m_queue) m_queue->shutdown();
    if (m_worker.joinable()) {
        m_worker.join();
    }
    m_state.store(ConnectionState::DISCONNECTED, std::memory_order_release);
}

ConnectionState WifiReceiver::state() const
{
    return m_state.load(std::memory_order_acquire);
}

WifiReceiver::Stats WifiReceiver::stats() const
{
    Stats s;
    s.frames_received = m_stat_received.load(std::memory_order_relaxed);
    s.frames_dropped  = m_queue ? m_queue->dropped_frames() : 0;
    s.decode_errors   = m_stat_decode_errors.load(std::memory_order_relaxed);
    return s;
}

// ── Forward a POST body to phone /api via WinINet ────────────────────────────
static std::string http_post_to_phone(const std::string& host, uint16_t port,
                                      const std::string& body)
{
    HINTERNET hSession = InternetOpenA("DexCamStudio/1.0", INTERNET_OPEN_TYPE_DIRECT, NULL, NULL, 0);
    if (!hSession) return "";

    DWORD timeout_ms = 4000;
    InternetSetOptionA(hSession, INTERNET_OPTION_CONNECT_TIMEOUT, &timeout_ms, sizeof(timeout_ms));
    InternetSetOptionA(hSession, INTERNET_OPTION_RECEIVE_TIMEOUT, &timeout_ms, sizeof(timeout_ms));
    InternetSetOptionA(hSession, INTERNET_OPTION_SEND_TIMEOUT, &timeout_ms, sizeof(timeout_ms));

    HINTERNET hConn = InternetConnectA(hSession, host.c_str(), port, NULL, NULL,
                                       INTERNET_SERVICE_HTTP, 0, 0);
    if (!hConn) { InternetCloseHandle(hSession); return ""; }
    HINTERNET hReq = HttpOpenRequestA(hConn, "POST", "/api", NULL, NULL, NULL,
                                      INTERNET_FLAG_NO_CACHE_WRITE | INTERNET_FLAG_RELOAD, 0);
    if (!hReq) { InternetCloseHandle(hConn); InternetCloseHandle(hSession); return ""; }
    const char* hdrs = "Content-Type: application/json\r\n";
    HttpSendRequestA(hReq, hdrs, (DWORD)strlen(hdrs), (LPVOID)body.data(), (DWORD)body.size());
    std::string resp;
    char buf[8192]; DWORD rd = 0;
    while (InternetReadFile(hReq, buf, sizeof(buf), &rd) && rd > 0)
        resp.append(buf, rd);
    InternetCloseHandle(hReq); InternetCloseHandle(hConn); InternetCloseHandle(hSession);
    return resp;
}

// ── WIC Hardware/SIMD JPEG to RGBA Decoder ───────────────────────────────────
static bool decode_jpeg_wic(IWICImagingFactory* pFactory,
                            const uint8_t* jpeg_data, size_t jpeg_len,
                            int32_t rotation,
                            std::vector<uint8_t>& rgba_out,
                            uint32_t& out_w, uint32_t& out_h)
{
    if (!pFactory || !jpeg_data || jpeg_len == 0) return false;

    IWICStream* pStream = NULL;
    HRESULT hr = pFactory->CreateStream(&pStream);
    if (FAILED(hr)) return false;

    hr = pStream->InitializeFromMemory((BYTE*)jpeg_data, (DWORD)jpeg_len);
    if (FAILED(hr)) { pStream->Release(); return false; }

    IWICBitmapDecoder* pDecoder = NULL;
    hr = pFactory->CreateDecoderFromStream(pStream, NULL, WICDecodeMetadataCacheOnDemand, &pDecoder);
    if (FAILED(hr)) { pStream->Release(); return false; }

    IWICBitmapFrameDecode* pFrame = NULL;
    hr = pDecoder->GetFrame(0, &pFrame);
    if (FAILED(hr)) { pDecoder->Release(); pStream->Release(); return false; }

    IWICFormatConverter* pConverter = NULL;
    hr = pFactory->CreateFormatConverter(&pConverter);
    if (FAILED(hr)) { pFrame->Release(); pDecoder->Release(); pStream->Release(); return false; }

    hr = pConverter->Initialize(pFrame, GUID_WICPixelFormat32bppRGBA,
                                WICBitmapDitherTypeNone, NULL, 0.0, WICBitmapPaletteTypeCustom);
    if (FAILED(hr)) {
        pConverter->Release(); pFrame->Release(); pDecoder->Release(); pStream->Release();
        return false;
    }

    IWICBitmapSource* pSource = pConverter;
    IWICBitmapFlipRotator* pRotator = NULL;

    WICBitmapTransformOptions rotOpt = WICBitmapTransformRotate0;
    if (rotation == 90) rotOpt = WICBitmapTransformRotate90;
    else if (rotation == 180) rotOpt = WICBitmapTransformRotate180;
    else if (rotation == 270) rotOpt = WICBitmapTransformRotate270;

    if (rotOpt != WICBitmapTransformRotate0) {
        if (SUCCEEDED(pFactory->CreateBitmapFlipRotator(&pRotator))) {
            if (SUCCEEDED(pRotator->Initialize(pConverter, rotOpt))) {
                pSource = pRotator;
            }
        }
    }

    UINT w = 0, h = 0;
    pSource->GetSize(&w, &h);
    out_w = w;
    out_h = h;
    size_t stride = (size_t)w * 4;
    rgba_out.resize(stride * h);
    hr = pSource->CopyPixels(NULL, (UINT)stride, (UINT)rgba_out.size(), rgba_out.data());

    if (pRotator) pRotator->Release();
    pConverter->Release();
    pFrame->Release();
    pDecoder->Release();
    pStream->Release();

    return SUCCEEDED(hr);
}

// ── Worker Main Loop ──────────────────────────────────────────────────────────
void WifiReceiver::worker_main(ReceiverConfig cfg,
                               StateChangeCb  state_cb,
                               ErrorCb        error_cb)
{
    m_phone_host = cfg.host;
    m_phone_port = cfg.port;

    blog(LOG_INFO, "[DexCam] Connecting directly to phone %s:%u (PIN: %s)",
         cfg.host.c_str(), cfg.port, cfg.pairing_code.c_str());

    if (state_cb) state_cb(ConnectionState::PAIRING, "Verifying PIN with phone...");

    bool paired = false;
    std::string token;

    while (!m_stop_flag.load(std::memory_order_acquire) && !paired) {
        std::string pair_body = "{\"action\":\"pair\",\"pin\":\"" + cfg.pairing_code + "\"}";
        std::string resp = http_post_to_phone(cfg.host, cfg.port, pair_body);

        if (!resp.empty()) {
            auto tok_pos = resp.find("\"token\":\"");
            if (tok_pos != std::string::npos) {
                tok_pos += 9;
                auto tok_end = resp.find("\"", tok_pos);
                if (tok_end != std::string::npos) {
                    token = resp.substr(tok_pos, tok_end - tok_pos);
                    paired = true;
                    m_session_token = token;
                    blog(LOG_INFO, "[DexCam] Pair SUCCESS! Token received: %s", token.c_str());
                    break;
                }
            } else if (resp.find("incorrect") != std::string::npos) {
                blog(LOG_ERROR, "[DexCam] Incorrect PIN entered.");
                if (error_cb) error_cb("Incorrect pairing PIN entered.");
                if (state_cb) state_cb(ConnectionState::ERROR_FATAL, "Incorrect PIN");
                m_state.store(ConnectionState::ERROR_FATAL, std::memory_order_release);
                return;
            }
        }

        if (state_cb) state_cb(ConnectionState::CONNECTING, "Connecting to phone " + cfg.host + ":" + std::to_string(cfg.port));

        for (int i = 0; i < 15 && !m_stop_flag.load(std::memory_order_acquire); ++i) {
            Sleep(100);
        }
    }

    if (!paired || m_stop_flag.load(std::memory_order_acquire)) {
        if (state_cb) state_cb(ConnectionState::DISCONNECTED, "Stopped");
        m_state.store(ConnectionState::DISCONNECTED, std::memory_order_release);
        return;
    }

    // Direct Connection ESTABLISHED!
    m_state.store(ConnectionState::CONNECTED, std::memory_order_release);
    if (state_cb) state_cb(ConnectionState::CONNECTED, "Connecting live video stream...");
    blog(LOG_INFO, "[DexCam] Connection established with phone %s:%u", cfg.host.c_str(), cfg.port);

    // ── Connect TCP Stream Socket to Phone Port 8002 ──────────────────────────
    SOCKET stream_sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (stream_sock == INVALID_SOCKET) {
        if (error_cb) error_cb("Failed to create stream socket");
        return;
    }

    int flag = 1;
    setsockopt(stream_sock, IPPROTO_TCP, TCP_NODELAY, (char*)&flag, sizeof(flag));
    int rcvbuf = 32 * 1024;
    setsockopt(stream_sock, SOL_SOCKET, SO_RCVBUF, (char*)&rcvbuf, sizeof(rcvbuf));

    sockaddr_in stream_addr = {};
    stream_addr.sin_family = AF_INET;
    stream_addr.sin_port = htons(8002);
    inet_pton(AF_INET, cfg.host.c_str(), &stream_addr.sin_addr);

    blog(LOG_INFO, "[DexCam] Connecting to direct stream socket on %s:8002...", cfg.host.c_str());
    if (connect(stream_sock, (sockaddr*)&stream_addr, sizeof(stream_addr)) == SOCKET_ERROR) {
        blog(LOG_ERROR, "[DexCam] Failed to connect to stream port 8002 (error %d)", WSAGetLastError());
        closesocket(stream_sock);
        if (error_cb) error_cb("Stream port 8002 unreachable. Ensure phone camera is running.");
        return;
    }

    m_stream_socket = (uintptr_t)stream_sock;
    blog(LOG_INFO, "[DexCam] Direct TCP stream connected! Starting live decode...");
    if (state_cb) state_cb(ConnectionState::CONNECTED, "Live video streaming");

    IWICImagingFactory* pWicFactory = NULL;
    CoInitializeEx(NULL, COINIT_MULTITHREADED);
    CoCreateInstance(CLSID_WICImagingFactory, NULL, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&pWicFactory));

    std::vector<uint8_t> jpeg_buf;
    std::vector<uint8_t> rgba_buf;
    uint64_t frame_count = 0;

    while (!m_stop_flag.load(std::memory_order_acquire)) {
        // Read Header: magic (4), len (4), width (4), height (4), rotation (4) = 20 bytes
        uint32_t header[5];
        if (!recv_all(stream_sock, (uint8_t*)header, sizeof(header))) {
            blog(LOG_WARNING, "[DexCam] Stream socket disconnected");
            break;
        }

        uint32_t magic    = ntohl(header[0]);
        uint32_t jpeg_len = ntohl(header[1]);
        uint32_t w        = ntohl(header[2]);
        uint32_t h        = ntohl(header[3]);
        uint32_t rot      = ntohl(header[4]);

        if (magic != 0x44455843 || jpeg_len == 0 || jpeg_len > 10 * 1024 * 1024) {
            blog(LOG_WARNING, "[DexCam] Invalid frame header (magic=0x%08X, len=%u)", magic, jpeg_len);
            continue;
        }

        if (jpeg_buf.size() < jpeg_len) {
            jpeg_buf.resize(jpeg_len);
        }

        if (!recv_all(stream_sock, jpeg_buf.data(), jpeg_len)) {
            blog(LOG_WARNING, "[DexCam] Stream socket disconnected during frame payload");
            break;
        }

        uint32_t out_w = 0, out_h = 0;
        if (decode_jpeg_wic(pWicFactory, jpeg_buf.data(), jpeg_len, rot, rgba_buf, out_w, out_h)) {
            DecodedFrame f;
            f.width = out_w;
            f.height = out_h;
            f.timestamp_us = mono_us();
            f.data = std::move(rgba_buf);

            if (m_queue) {
                m_queue->push(std::move(f));
            }
            m_stat_received.fetch_add(1, std::memory_order_relaxed);
            frame_count++;
            if (frame_count % 90 == 0) {
                blog(LOG_INFO, "[DexCam] Stream active: %llu frames decoded (%ux%u rot=%d)",
                     frame_count, out_w, out_h, rot);
            }
        } else {
            m_stat_decode_errors.fetch_add(1, std::memory_order_relaxed);
        }
    }

    if (pWicFactory) pWicFactory->Release();
    CoUninitialize();

    closesocket(stream_sock);
    m_stream_socket = ~0ULL;

    // Disconnect cleanup
    if (!token.empty()) {
        std::string dc_body = "{\"action\":\"disconnect\",\"token\":\"" + token + "\"}";
        http_post_to_phone(cfg.host, cfg.port, dc_body);
    }

    m_state.store(ConnectionState::DISCONNECTED, std::memory_order_release);
    if (state_cb) state_cb(ConnectionState::DISCONNECTED, "Disconnected");
    blog(LOG_INFO, "[DexCam] Receiver disconnected cleanly");
}

bool WifiReceiver::send_control(const std::string& action, const std::string& extra_json)
{
    if (m_session_token.empty() || m_phone_host.empty()) {
        blog(LOG_WARNING, "[DexCam] Cannot send control '%s': not connected", action.c_str());
        return false;
    }

    std::string body = "{\"action\":\"" + action + "\",\"token\":\"" + m_session_token + "\"";
    if (!extra_json.empty()) {
        body += "," + extra_json;
    }
    body += "}";

    std::string resp = http_post_to_phone(m_phone_host, m_phone_port, body);
    bool ok = (resp.find("\"ok\":true") != std::string::npos ||
               resp.find("\"saved\":true") != std::string::npos ||
               resp.find("\"mode\":") != std::string::npos ||
               resp.find("\"audioMode\":") != std::string::npos);
    blog(LOG_INFO, "[DexCam] Control '%s' -> %s (resp: %s)",
         action.c_str(), ok ? "OK" : "FAILED", resp.c_str());
    return ok;
}

} // namespace dexcam
