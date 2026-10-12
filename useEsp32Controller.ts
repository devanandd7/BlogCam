import { useEffect, useRef, useState, useCallback } from 'react';
import RNFS from 'react-native-fs';

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
  const [statusMessage, setStatusMessage] = useState<string>('Disconnected');

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIpRef = useRef<string>(DEFAULT_ESP32_IP);
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
        setIsConnecting(false);
        setStatusMessage('Connected');

        // Immediately push current app state
        sendStateUpdate(appStateRef.current);
      };

      socket.onmessage = event => {
        try {
          const data = JSON.parse(event.data);
          console.log('[ESP32 WS] Received:', data);

          if (data?.type === 'action' && typeof data.action === 'string') {
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
      };

      socket.onclose = () => {
        console.log('[ESP32 WS] Connection closed.');
        setIsConnected(false);
        setIsConnecting(false);
        setStatusMessage('Disconnected');
        wsRef.current = null;

        // Auto-reconnect after 4 seconds
        reconnectTimerRef.current = setTimeout(() => {
          connectToController();
        }, 4000);
      };
    } catch (err) {
      console.warn('[ESP32 WS] Connection init failed:', err);
      setIsConnected(false);
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
    setIsConnecting(false);
    setStatusMessage('Disconnected');
  }, []);

  // Connect on mount, cleanup on unmount
  useEffect(() => {
    connectToController();
    return () => {
      disconnect();
    };
  }, [connectToController, disconnect]);

  return {
    esp32Ip,
    setEsp32Ip,
    isConnected,
    isConnecting,
    statusMessage,
    connect: connectToController,
    disconnect,
  };
}
