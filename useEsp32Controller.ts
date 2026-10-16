import { useEffect, useRef, useState, useCallback } from 'react';
import { NativeModules } from 'react-native';
import RNFS from 'react-native-fs';
import { NetworkInfo } from 'react-native-network-info';
import { DexCamLogger } from './DexCamLogger';

export type ControllerState = {
  serverReady: boolean;
  obsConnected: boolean;
  recordingState: 'idle' | 'preparing' | 'recording' | 'paused';
  flashEnabled: boolean;
  cameraFacing: 'back' | 'front';
};

export type ControllerActions = {
  onRecordToggle?: () => void;
  onRecordPauseToggle?: () => void;
  onFlipCamera?: () => void;
  onToggleFlash?: () => void;
  onTakePhoto?: () => void;
  onCloseSession?: () => void;
};

const CONFIG_PATH = `${RNFS.DocumentDirectoryPath}/esp32_controller_config.json`;
const DEFAULT_ESP32_IP = '192.168.1.50';

export function useEsp32Controller(
  appState: ControllerState,
  actions: ControllerActions,
) {
  const [esp32Ip, setEsp32IpState] = useState<string>(DEFAULT_ESP32_IP);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('Disconnected');

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIpRef = useRef<string>(DEFAULT_ESP32_IP);
  const isConnectedRef = useRef<boolean>(false);
  isConnectedRef.current = isConnected;

  const isSearchingRef = useRef<boolean>(false);

  const actionsRef = useRef<ControllerActions>(actions);
  actionsRef.current = actions;

  const appStateRef = useRef<ControllerState>(appState);
  appStateRef.current = appState;

  // Load saved IP on mount
  useEffect(() => {
    RNFS.readFile(CONFIG_PATH, 'utf8')
      .then(content => {
        try {
          const parsed = JSON.parse(content);
          if (parsed?.ip && typeof parsed.ip === 'string') {
            setEsp32IpState(parsed.ip);
            activeIpRef.current = parsed.ip;
          }
        } catch {
          // ignore invalid json
        }
      })
      .catch(() => {
        // file doesn't exist yet, using default
      });
  }, []);

  // Update & persist IP
  const setEsp32Ip = useCallback((newIp: string) => {
    const trimmed = newIp.trim();
    setEsp32IpState(trimmed);
    activeIpRef.current = trimmed;
    RNFS.writeFile(CONFIG_PATH, JSON.stringify({ ip: trimmed }), 'utf8').catch(
      () => {},
    );
  }, []);

  // Send state update to ESP32 over WebSocket
  const sendStateUpdate = useCallback((state: ControllerState) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify({
        type: 'state',
        serverReady: state.serverReady,
        obsConnected: state.obsConnected,
        recordingState: state.recordingState,
        flashEnabled: state.flashEnabled,
        cameraFacing: state.cameraFacing,
      });
      try {
        socket.send(payload);
      } catch (e) {
        console.warn('Failed to send state to ESP32:', e);
      }
    }
  }, []);

  // Watch for app state changes and push to ESP32
  useEffect(() => {
    if (isConnected) {
      sendStateUpdate(appState);
    }
  }, [
    appState.serverReady,
    appState.obsConnected,
    appState.recordingState,
    appState.flashEnabled,
    appState.cameraFacing,
    isConnected,
    sendStateUpdate,
  ]);

  // Connect to ESP32 WebSocket server
  const connectToController = useCallback((targetIp?: string) => {
    const ip = targetIp || activeIpRef.current;
    if (!ip) {
      setStatusMessage('Enter ESP32 IP');
      return;
    }

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    setIsConnecting(true);
    setStatusMessage(`Connecting to ${ip}:81...`);

    try {
      const wsUrl = `ws://${ip}:81/`;
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        console.log(`[ESP32 WS] Connected to ${wsUrl}`);
        setIsConnected(true);
        isConnectedRef.current = true;
        setIsConnecting(false);
        setStatusMessage('Connected');

        DexCamLogger.info('ESP32', 'esp32_connected', { wsUrl, ip });

        // Immediately push current app state
        sendStateUpdate(appStateRef.current);
      };

      socket.onmessage = event => {
        try {
          const data = JSON.parse(event.data);
          console.log('[ESP32 WS] Received:', data);

          if (data?.type === 'action' && typeof data.action === 'string') {
            DexCamLogger.info('ESP32', 'button_press_received', { action: data.action });
            const currentActions = actionsRef.current;
            switch (data.action) {
              case 'record-toggle':
                currentActions.onRecordToggle?.();
                break;
              case 'record-pause-toggle':
                currentActions.onRecordPauseToggle?.();
                break;
              case 'flip':
                currentActions.onFlipCamera?.();
                break;
              case 'flash':
                currentActions.onToggleFlash?.();
                break;
              case 'photo':
                currentActions.onTakePhoto?.();
                break;
              case 'close-session':
                currentActions.onCloseSession?.();
                break;
              default:
                console.log(`[ESP32 WS] Unknown action: ${data.action}`);
                break;
            }
          }
        } catch {
          // ignore non-json messages
        }
      };

      socket.onerror = error => {
        console.warn('[ESP32 WS] Error:', error);
        DexCamLogger.error('ESP32', 'ws_error', { ip }, error);
      };

      socket.onclose = () => {
        console.log('[ESP32 WS] Connection closed.');
        setIsConnected(false);
        isConnectedRef.current = false;
        setIsConnecting(false);
        setStatusMessage('Disconnected');
        wsRef.current = null;

        DexCamLogger.warn('ESP32', 'ws_closed', { ip });

        // Auto-reconnect after 4 seconds if not already searching
        if (!isSearchingRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            connectToController();
          }, 4000);
        }
      };
    } catch (err) {
      console.warn('[ESP32 WS] Connection init failed:', err);
      setIsConnected(false);
      isConnectedRef.current = false;
      setIsConnecting(false);
      setStatusMessage('Connection failed');
    }
  }, [sendStateUpdate]);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    setIsConnected(false);
    isConnectedRef.current = false;
    setIsConnecting(false);
    setStatusMessage('Disconnected');
  }, []);

  // Auto-Discovery: Probes the local network to find ESP32 without opening PC IDE
  const autoDiscover = useCallback(async (): Promise<string | null> => {
    if (isConnectedRef.current) {
      return activeIpRef.current;
    }
    if (isSearchingRef.current) {
      return null;
    }

    isSearchingRef.current = true;
    setIsSearching(true);
    setStatusMessage('Searching for ESP32...');

    const probeIp = async (ip: string, timeoutMs = 400): Promise<boolean> => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(`http://${ip}/esp32-status`, {
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
          const json = await res.json();
          if (json?.device === 'DexCam-ESP32') {
            return true;
          }
        }
      } catch {
        // unreachable or timeout
      }
      return false;
    };

    try {
      // 1. Try currently configured IP first
      const currentIp = activeIpRef.current;
      if (currentIp && currentIp !== '0.0.0.0') {
        const ok = await probeIp(currentIp, 500);
        if (ok) {
          console.log(`[ESP32 DISCOVERY] Found on saved IP: ${currentIp}`);
          connectToController(currentIp);
          setIsSearching(false);
          isSearchingRef.current = false;
          return currentIp;
        }
      }

      // 2. Discover local IP subnet
      let myIp: string | null = null;
      try {
        if (NativeModules.BlogCamTorch?.getNetworkIpAddresses) {
          const list = await NativeModules.BlogCamTorch.getNetworkIpAddresses();
          if (Array.isArray(list) && list.length > 0) {
            for (const item of list) {
              if (
                item?.address &&
                item.address !== '127.0.0.1' &&
                !item.address.startsWith('169.254.') &&
                item.address.includes('.')
              ) {
                myIp = item.address;
                break;
              }
            }
          }
        }
      } catch (e) {
        console.warn('[ESP32 DISCOVERY] BlogCamTorch IP check failed:', e);
      }

      if (!myIp) {
        try {
          myIp = await NetworkInfo.getIPV4Address();
        } catch (e) {
          console.warn('[ESP32 DISCOVERY] Could not get local IPv4:', e);
        }
      }

      if (!myIp) {
        try {
          myIp = await NetworkInfo.getIPAddress();
        } catch {}
      }

      if (!myIp || !myIp.includes('.')) {
        setStatusMessage('ESP32 not found (No Wi-Fi)');
        setIsSearching(false);
        isSearchingRef.current = false;
        return null;
      }

      const parts = myIp.split('.');
      if (parts.length !== 4) {
        setStatusMessage('ESP32 not found');
        setIsSearching(false);
        isSearchingRef.current = false;
        return null;
      }

      const subnetPrefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
      const myHostNum = parseInt(parts[3], 10);

      // 3. Build prioritized list of candidate IPs
      const candidateList: string[] = [];

      // Check Gateway first (often router or phone hotspot)
      try {
        const gateway = await NetworkInfo.getGatewayIPAddress();
        if (gateway && gateway !== myIp && gateway.startsWith(subnetPrefix)) {
          candidateList.push(gateway);
        }
      } catch {}

      // Common DHCP ranges: 2..50, 100..160, 51..99, 161..254
      const addRange = (start: number, end: number) => {
        for (let i = start; i <= end; i++) {
          const candidate = `${subnetPrefix}.${i}`;
          if (i !== myHostNum && !candidateList.includes(candidate)) {
            candidateList.push(candidate);
          }
        }
      };

      addRange(2, 50);
      addRange(100, 160);
      addRange(51, 99);
      addRange(161, 254);

      // 4. Batch sweep candidate IPs in chunks of 25 with 350ms timeout
      const CHUNK_SIZE = 25;
      for (let i = 0; i < candidateList.length; i += CHUNK_SIZE) {
        const chunk = candidateList.slice(i, i + CHUNK_SIZE);
        const results = await Promise.all(
          chunk.map(async ip => {
            const found = await probeIp(ip, 350);
            return found ? ip : null;
          }),
        );

        const foundIp = results.find(ip => ip !== null);
        if (foundIp) {
          console.log(`[ESP32 DISCOVERY] ESP32 found at ${foundIp}!`);
          DexCamLogger.info('ESP32', 'auto_discover_success', { foundIp });
          setEsp32Ip(foundIp);
          connectToController(foundIp);
          setIsSearching(false);
          isSearchingRef.current = false;
          return foundIp;
        }
      }

      DexCamLogger.warn('ESP32', 'auto_discover_not_found', { subnetPrefix });
      setStatusMessage('ESP32 not found. Check Wi-Fi');
    } catch (err) {
      console.warn('[ESP32 DISCOVERY] Sweep failed:', err);
      setStatusMessage('Discovery failed');
    } finally {
      setIsSearching(false);
      isSearchingRef.current = false;
    }

    return null;
  }, [connectToController, setEsp32Ip]);

  // Connect on mount, and attempt background auto-discovery after 2.5s if offline
  useEffect(() => {
    connectToController();

    const discoveryTimer = setTimeout(() => {
      if (!isConnectedRef.current) {
        autoDiscover();
      }
    }, 2500);

    return () => {
      clearTimeout(discoveryTimer);
      disconnect();
    };
  }, [connectToController, disconnect, autoDiscover]);

  return {
    esp32Ip,
    setEsp32Ip,
    isConnected,
    isConnecting,
    isSearching,
    statusMessage,
    connect: connectToController,
    disconnect,
    autoDiscover,
  };
}
