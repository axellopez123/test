import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  Button,
  StyleSheet,
  PermissionsAndroid,
  TextInput,
  Platform,
} from "react-native";
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
} from "react-native-webrtc";

interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

interface SignalingMessage {
  type: "offer" | "answer" | "ice-candidate" | "server-response" | "error";
  sdp?: string;
  candidate?: RTCIceCandidate;
  data?: any;
  error?: string;
}

const WebRTCAudioApp = () => {
  const [status, setStatus] = useState<string>("Desconectado");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [iceServers, setIceServers] = useState<IceServer[]>([]);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [serverMessages, setServerMessages] = useState<string[]>([]);

  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const clientId = useRef<string>(
    `client-${Math.random().toString(36).substring(7)}`
  );

  // Configuración inicial
  useEffect(() => {
    if (
      ws.current?.readyState === WebSocket.OPEN ||
      ws.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    requestMicrophonePermission();
    setupWebSocket();

    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    if (ws.current) {
      ws.current.close();
      ws.current = null;
    }
    stopStreaming();
  };

  const requestMicrophonePermission = async () => {
    if (Platform.OS !== "android") return;

 try {
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      PermissionsAndroid.PERMISSIONS.CAMERA,
    ]);

    const micPermission = granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
    const cameraPermission = granted[PermissionsAndroid.PERMISSIONS.CAMERA];

    if (
      micPermission !== PermissionsAndroid.RESULTS.GRANTED ||
      cameraPermission !== PermissionsAndroid.RESULTS.GRANTED
    ) {
      console.warn("Permisos denegados");
      return false;
    }

    return true;

  } catch (err) {
    console.warn("Error al solicitar permisos:", err);
    return false;
  }
  };

  const setupWebSocket = () => {
    const wsUrl = `wss://ventaja-backend.arwax.pro/api/webrtc/ws/webrtc/${clientId.current}`;
    ws.current = new WebSocket(wsUrl, "protoo");

    ws.current.onopen = () => {
      console.log("WebSocket conectado");
      setStatus("Conectado al servidor");
      setWsConnected(true);
      getIceServers();
    };

    ws.current.onmessage = (event) => {
      try {
        const message: SignalingMessage = JSON.parse(event.data);
        try {
          handleSignalingMessage(message);
        } catch (err) {
          console.error("Error al manejar mensaje:", err);
        }
      } catch (error) {
        console.error("Error al parsear mensaje:", error);
      }
    };

    ws.current.onerror = (error) => {
      console.error("Error WebSocket:", error?.message || error);
      setStatus("Error de conexión");
      setWsConnected(false);
    };

    ws.current.onclose = (e) => {
      console.warn("WebSocket cerrado:", e.reason || "sin razón");
      if (isStreaming) stopStreaming();
      setStatus("Desconectado del servidor");
      setWsConnected(false);
      // console.log("WebSocket desconectado");
      // setStatus("Desconectado del servidor");
      // setWsConnected(false);

      // Intentar reconectar después de 3 segundos
      // setTimeout(() => {
      //   console.log('Reintentando conexión WebSocket...');
      //   setupWebSocket();
      // }, 3000);
    };
  };

  const getIceServers = async () => {
    try {
      const response = await fetch(
        "https://ventaja-backend.arwax.pro/api/webrtc/turn-credentials"
      );
      const data = await response.json();
      const servers: IceServer[] = [
        { urls: ["stun:stun.l.google.com:19302"] },
        ...data,
      ];
      setIceServers(servers);
    } catch (error) {
      console.error("Error al obtener servidores ICE:", error);
      setIceServers([{ urls: ["stun:stun.l.google.com:19302"] }]);
    }
  };

  const startStreaming = async () => {
    if (!wsConnected || isStreaming) return;

    setStatus("Iniciando transmisión de audio...");
    setIsStreaming(true);

    try {
      // 1. Configurar conexión WebRTC optimizada para audio
      peerConnection.current = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy: "relay", // Para producción usa 'all'
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
        iceCandidatePoolSize: 0, // Ahorra recursos
      });

      // 2. Configurar manejadores de eventos
      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignalingMessage({
            type: "ice-candidate",
            candidate: event.candidate,
          });
        }
      };

      peerConnection.current.onconnectionstatechange = () => {
        const state = peerConnection.current?.connectionState;
        console.log("Estado conexión:", state);

        if (state === "connected") {
          setStatus("Transmitiendo audio al servidor");
        } else if (state === "disconnected" || state === "failed") {
          setStatus("Conexión perdida");
          stopStreaming();
        }
      };

      // 3. Obtener stream de audio optimizado
      // localStream.current = await mediaDevices.getUserMedia({
      //   audio: {
      //     echoCancellation: true,
      //     noiseSuppression: true,
      //     autoGainControl: true,
      //     channelCount: 1,
      //     sampleRate: 16000, // Ideal para análisis de voz
      //     sampleSize: 16,
      //     volume: 1.0,
      //   },
      //   video: false,
      // });

      try {
        localStream.current = await mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      } catch (err) {
        console.error("❌ Error al obtener audio:", err);
        setStatus("Error: No se pudo obtener el micrófono");
        stopStreaming();
        return;
      }

      // 4. Agregar pistas
      localStream.current.getTracks().forEach((track) => {
        peerConnection.current?.addTrack(track, localStream.current!);
      });

      // 5. Crear oferta optimizada para audio
      const offer = await peerConnection.current.createOffer({
        offerToReceiveAudio: false, // Solo enviamos audio al servidor
        offerToReceiveVideo: false,
      });

      // Configuración adicional para optimizar audio
      await peerConnection.current.setLocalDescription(offer);

      // 6. Enviar oferta al servidor
      if (peerConnection.current.localDescription) {
        sendSignalingMessage({
          type: "offer",
          sdp: peerConnection.current.localDescription.sdp,
        });
      }
    } catch (error) {
      console.error("Error al iniciar transmisión:", error);
      setStatus(`Error: ${error.message}`);
      stopStreaming();
    }
  };

  const stopStreaming = () => {
    setStatus("Deteniendo transmisión...");

    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }

    if (localStream.current) {
      localStream.current.getTracks().forEach((track) => track.stop());
      localStream.current = null;
    }

    setIsStreaming(false);
    setStatus(wsConnected ? "Conectado (en espera)" : "Desconectado");
  };

  const handleSignalingMessage = async (message: SignalingMessage) => {
    console.log("Mensaje recibido:", message.type);

    try {
      switch (message.type) {
        case "answer":
          if (!peerConnection.current || !message.sdp) return;
          try {
            await peerConnection.current.setRemoteDescription(
              new RTCSessionDescription({
                type: "answer",
                sdp: message.sdp,
              })
            );
          } catch (error) {
            console.error("Error al aplicar respuesta SDP:", error);
          }
          break;
        case "ice-candidate":
          if (!peerConnection.current || !message.candidate) return;

          try {
            const candidate = new RTCIceCandidate({
              candidate: message.candidate.candidate,
              sdpMid: message.candidate.sdpMid,
              sdpMLineIndex: message.candidate.sdpMLineIndex,
            });

            await peerConnection.current.addIceCandidate(candidate);
          } catch (error) {
            console.error("Error al agregar ICE candidate:", error);
          }
          break;

        case "server-response":
          // Procesar respuestas del servidor
          console.log("Respuesta del servidor:", message.data);
          setServerMessages((prev) => [
            ...prev,
            message.data.message || "Audio procesado",
          ]);
          break;

        case "error":
          console.error("Error del servidor:", message.error);
          setStatus(`Error: ${message.error}`);
          break;

        default:
          console.warn("Tipo de mensaje no reconocido:", message.type);
      }
    } catch (error) {
      console.error("Error al manejar mensaje:", error);
    }
  };

  const sendSignalingMessage = (message: SignalingMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    } else {
      console.warn("WebSocket no está conectado");
      setStatus("Error: Conexión perdida con el servidor");
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.statusText}>Estado: {status}</Text>
      <Text style={styles.idText}>ID Cliente: {clientId.current}</Text>

      <View style={styles.buttonContainer}>
        <Button
          title={isStreaming ? "Detener Transmisión" : "Iniciar Transmisión"}
          onPress={isStreaming ? stopStreaming : startStreaming}
          disabled={!wsConnected}
          color={isStreaming ? "#ff4444" : "#009900"}
        />
      </View>

      <View style={styles.messagesContainer}>
        <Text style={styles.messagesTitle}>Respuestas del Servidor:</Text>
        {serverMessages.map((msg, index) => (
          <Text key={index} style={styles.messageText}>
            • {msg}
          </Text>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: "#f5f5f5",
  },
  statusText: {
    fontSize: 18,
    textAlign: "center",
    marginBottom: 10,
    fontWeight: "bold",
    color: "#333",
  },
  idText: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 20,
    color: "#666",
  },
  buttonContainer: {
    marginBottom: 30,
    paddingHorizontal: 50,
  },
  messagesContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  messagesTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 10,
    color: "#444",
  },
  messageText: {
    fontSize: 14,
    marginBottom: 5,
    color: "#555",
  },
});

export default WebRTCAudioApp;
