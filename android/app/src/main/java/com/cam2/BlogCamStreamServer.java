package com.cam2;

import android.graphics.ImageFormat;
import android.graphics.Rect;
import android.graphics.YuvImage;
import android.media.Image;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;

public final class BlogCamStreamServer {
    private static final String TAG = "BlogCamStream";
    public static final int DEFAULT_PORT = 8002;
    private static final int MAGIC = 0x44455843; // 'DEXC'

    private static ServerSocket serverSocket = null;
    private static Thread serverThread = null;
    private static volatile Socket activeClient = null;
    private static volatile DataOutputStream activeOut = null;
    private static final AtomicBoolean isSending = new AtomicBoolean(false);
    private static final AtomicBoolean isRunning = new AtomicBoolean(false);

    private static byte[] nv21Buffer = null;

    public static synchronized void start(int port) {
        if (isRunning.get()) return;
        isRunning.set(true);

        serverThread = new Thread(() -> {
            try {
                serverSocket = new ServerSocket(port);
                serverSocket.setReuseAddress(true);
                Log.i(TAG, "Direct Stream Server listening on TCP port " + port);

                while (isRunning.get()) {
                    Socket client = serverSocket.accept();
                    client.setTcpNoDelay(true);
                    client.setSendBufferSize(256 * 1024);
                    Log.i(TAG, "OBS Studio client connected from " + client.getRemoteSocketAddress());

                    synchronized (BlogCamStreamServer.class) {
                        closeActiveClient();
                        activeClient = client;
                        activeOut = new DataOutputStream(client.getOutputStream());
                    }
                }
            } catch (IOException e) {
                if (isRunning.get()) {
                    Log.w(TAG, "Server socket error: " + e.getMessage());
                }
            } finally {
                closeActiveClient();
            }
        }, "BlogCamStreamServer");

        serverThread.setDaemon(true);
        serverThread.start();
    }

    public static synchronized void stop() {
        isRunning.set(false);
        closeActiveClient();
        if (serverSocket != null) {
            try { serverSocket.close(); } catch (Exception ignored) {}
            serverSocket = null;
        }
        if (serverThread != null) {
            serverThread.interrupt();
            serverThread = null;
        }
    }

    public static boolean hasClients() {
        Socket c = activeClient;
        return c != null && !c.isClosed() && c.isConnected();
    }

    private static synchronized void closeActiveClient() {
        if (activeOut != null) {
            try { activeOut.close(); } catch (Exception ignored) {}
            activeOut = null;
        }
        if (activeClient != null) {
            try { activeClient.close(); } catch (Exception ignored) {}
            activeClient = null;
        }
    }

    public static void pushFrame(Image image, int width, int height, int rotation) {
        if (!hasClients()) return;

        // Drop frame if previous is still transmitting (preserves strictly zero latency)
        if (!isSending.compareAndSet(false, true)) {
            return;
        }

        try {
            byte[] nv21 = convertYuv420ToNv21(image, width, height);
            if (nv21 == null) return;

            ByteArrayOutputStream jpegOut = new ByteArrayOutputStream(width * height / 4);
            YuvImage yuv = new YuvImage(nv21, ImageFormat.NV21, width, height, null);
            yuv.compressToJpeg(new Rect(0, 0, width, height), 75, jpegOut);
            byte[] jpegBytes = jpegOut.toByteArray();

            DataOutputStream out = activeOut;
            if (out != null) {
                out.writeInt(MAGIC);
                out.writeInt(jpegBytes.length);
                out.writeInt(width);
                out.writeInt(height);
                out.writeInt(rotation);
                out.write(jpegBytes);
                out.flush();
            }
        } catch (IOException e) {
            Log.w(TAG, "Client stream disconnected: " + e.getMessage());
            closeActiveClient();
        } catch (Throwable t) {
            Log.w(TAG, "Frame encode error: " + t.getMessage());
        } finally {
            isSending.set(false);
        }
    }

    private static synchronized byte[] convertYuv420ToNv21(Image image, int width, int height) {
        Image.Plane[] planes = image.getPlanes();
        if (planes == null || planes.length < 3) return null;

        int totalSize = width * height * 3 / 2;
        if (nv21Buffer == null || nv21Buffer.length != totalSize) {
            nv21Buffer = new byte[totalSize];
        }

        ByteBuffer yBuffer = planes[0].getBuffer();
        ByteBuffer uBuffer = planes[1].getBuffer();
        ByteBuffer vBuffer = planes[2].getBuffer();

        int yRowStride = planes[0].getRowStride();
        int yPixelStride = planes[0].getPixelStride();
        int pos = 0;

        if (yRowStride == width && yPixelStride == 1) {
            yBuffer.position(0);
            yBuffer.get(nv21Buffer, 0, width * height);
            pos = width * height;
        } else {
            for (int row = 0; row < height; row++) {
                yBuffer.position(row * yRowStride);
                yBuffer.get(nv21Buffer, pos, width);
                pos += width;
            }
        }

        int uvRowStride = planes[2].getRowStride();
        int uvPixelStride = planes[2].getPixelStride();
        int uvHeight = height / 2;
        int uvWidth = width / 2;

        for (int row = 0; row < uvHeight; row++) {
            for (int col = 0; col < uvWidth; col++) {
                int vIndex = row * uvRowStride + col * uvPixelStride;
                int uIndex = row * planes[1].getRowStride() + col * planes[1].getPixelStride();
                nv21Buffer[pos++] = vBuffer.get(vIndex);
                nv21Buffer[pos++] = uBuffer.get(uIndex);
            }
        }

        return nv21Buffer;
    }
}
