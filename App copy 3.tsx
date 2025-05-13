import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Button, StyleSheet, PermissionsAndroid, TextInput, Platform } from 'react-native';
import { RTCPeerConnection, RTCSessionDescription, mediaDevices } from 'react-native-webrtc';

interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

interface SignalingMessage {
  type: string;
  sender?: string;
  target?: string;
  offer?: RTCSessionDescription;
  answer?: RTCSessionDescription;
  candidate?: RTCIceCandidate;
  servers?: IceServer[];
}

const WebRTCAudioApp = () => {
  const [status, setStatus] = useState<string>('Desconectado');
  const [isCalling, setIsCalling] = useState<boolean>(false);
  const [iceServers, setIceServers] = useState<IceServer[]>([]);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [targetInput, setTargetInput] = useState<string>('');
  
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const clientId = useRef<string>(`client-${Math.random().toString(36).substring(7)}`);

  // Configuración inicial
  useEffect(() => {
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
    stopCall();
  };

  const requestMicrophonePermission = async () => {
    if (Platform.OS !== 'android') return;
    
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Permisos de Micrófono',
          message: 'Esta app necesita acceso a tu micrófono',
          buttonPositive: 'OK',
        },
      );
      if (granted === PermissionsAndroid.RESULTS.GRANTED) {
        console.log('Permiso de micrófono concedido');
      } else {
        console.log('Permiso de micrófono denegado');
        setStatus('Error: Sin permisos de micrófono');
      }
    } catch (err) {
      console.warn('Error al solicitar permiso:', err);
    }
  };

  const setupWebSocket = () => {
    const wsUrl = `wss://ventaja-backend.arwax.pro/api/webrtc/ws/webrtc/${clientId.current}`;
    ws.current = new WebSocket(wsUrl, [], {
      headers: {
        'Origin': 'https://tu-dominio.com',
        'Sec-WebSocket-Protocol': 'protoo',
        'X-Client-Type': 'react-native'
      }
    });
    // ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      console.log('WebSocket conectado');
      setStatus('Conectado al servidor');
      setWsConnected(true);
      getTurnConfig();
    };

    // ws.current.onmessage = (event) => {
    //   try {
    //     const message: SignalingMessage = JSON.parse(event.data);
    //     handleSignalingMessage(message);
    //   } catch (error) {
    //     console.error('Error al parsear mensaje:', error);
    //   }
    // };

    ws.current.onmessage = (rawEvent: any) => {
      const event = {
        ...rawEvent,
        data: tryParseJson(rawEvent.data),
        type: 'message',
        nativeEvent: rawEvent
      };
      handleSignalingMessage(event.data);
    };

    const tryParseJson = (data: any) => {
      try {
        return JSON.parse(data);
      } catch (e) {
        console.warn('Error parsing message:', data);
        return null;
      }
    };

    ws.current.onerror = (error) => {
      console.error('Error WebSocket:', error);
      setStatus('Error de conexión');
    };

    ws.current.onclose = () => {
      console.log('WebSocket desconectado');
      setWsConnected(false);
      setStatus('Desconectado del servidor');
    };
  };

  const getTurnConfig = async () => {
    try {
      const response = await fetch('https://ventaja-backend.arwax.pro/api/webrtc/turn-credentials');
      const data = await response.json();
      const servers: IceServer[] = [
        { urls: ['stun:stun.l.google.com:19302'] },
        ...data
      ];
      setIceServers(servers);
    } catch (error) {
      console.error('Error al obtener TURN:', error);
      setIceServers([{ urls: ['stun:stun.l.google.com:19302'] }]);
    }
  };

  const startCall = async () => {
    if (!wsConnected || isCalling || !targetInput) return;

    setStatus('Iniciando llamada...');
    setIsCalling(true);

    try {
      // 1. Configurar conexión WebRTC
      peerConnection.current = new RTCPeerConnection({ iceServers });

      // 2. Configurar manejadores de eventos
      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignalingMessage({
            type: 'ice-candidate',
            target: targetInput,
            candidate: event.candidate,
          });
        }
      };

      peerConnection.current.onconnectionstatechange = () => {
        console.log('Estado conexión:', peerConnection.current?.connectionState);
      };

      // 3. Obtener stream de audio
      localStream.current = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
        video: false,
      });

      // 4. Agregar pistas
      localStream.current.getTracks().forEach(track => {
        peerConnection.current?.addTrack(track, localStream.current!);
      });

      // 5. Crear oferta
      const offer = await peerConnection.current.createOffer({
        offerToReceiveAudio: true,
      });
      await peerConnection.current.setLocalDescription(offer);

      // 6. Enviar oferta
      sendSignalingMessage({
        type: 'offer',
        target: targetInput,
        offer: offer,
      });

      setStatus(`Llamando a ${targetInput}...`);

    } catch (error) {
      console.error('Error al iniciar llamada:', error);
      setStatus('Error al iniciar llamada');
      stopCall();
    }
  };

  const stopCall = () => {
    setStatus('Finalizando llamada...');
    
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }

    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }

    setIsCalling(false);
    setStatus(wsConnected ? 'Conectado (en espera)' : 'Desconectado');
  };

  const handleSignalingMessage = async (message: SignalingMessage) => {
    console.log('Mensaje recibido:', message.type);
    
    try {
      switch (message.type) {
        case 'offer':
          await handleOffer(message);
          break;
        case 'answer':
          await handleAnswer(message);
          break;
        case 'ice-candidate':
          await handleIceCandidate(message);
          break;
        case 'ice-servers':
          if (message.servers) setIceServers(message.servers);
          break;
        default:
          console.warn('Tipo de mensaje no reconocido:', message.type);
      }
    } catch (error) {
      console.error('Error al manejar mensaje:', error);
    }
  };

  const handleOffer = async (message: SignalingMessage) => {
    if (isCalling || !message.offer || !message.sender) return;

    setStatus(`Recibiendo llamada de ${message.sender}...`);
    setIsCalling(true);
    setTargetInput(message.sender);

    try {
      // 1. Crear nueva conexión
      peerConnection.current = new RTCPeerConnection({ iceServers });

      // 2. Configurar manejadores
      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate && message.sender) {
          sendSignalingMessage({
            type: 'ice-candidate',
            target: message.sender,
            candidate: event.candidate,
          });
        }
      };

      // 3. Obtener stream local
      localStream.current = await mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
        video: false,
      });

      // 4. Agregar pistas
      localStream.current.getTracks().forEach(track => {
        peerConnection.current?.addTrack(track, localStream.current!);
      });

      // 5. Establecer descripción remota
      await peerConnection.current.setRemoteDescription(
        new RTCSessionDescription(message.offer)
      );

      // 6. Crear y enviar respuesta
      const answer = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answer);

      sendSignalingMessage({
        type: 'answer',
        target: message.sender,
        answer: answer,
      });

      setStatus(`En llamada con ${message.sender}`);

    } catch (error) {
      console.error('Error al manejar oferta:', error);
      stopCall();
    }
  };

  const handleAnswer = async (message: SignalingMessage) => {
    if (!peerConnection.current || !message.answer) return;

    try {
      await peerConnection.current.setRemoteDescription(
        new RTCSessionDescription(message.answer)
      );
      setStatus(`Llamada conectada con ${targetInput}`);
    } catch (error) {
      console.error('Error al manejar respuesta:', error);
      stopCall();
    }
  };

  const handleIceCandidate = async (message: SignalingMessage) => {
    if (!peerConnection.current || !message.candidate) return;

    try {
      await peerConnection.current.addIceCandidate(message.candidate);
    } catch (error) {
      console.error('Error al agregar ICE candidate:', error);
    }
  };

  const sendSignalingMessage = (message: SignalingMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        ...message,
        sender: clientId.current
      }));
    } else {
      console.warn('WebSocket no está conectado');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.statusText}>Estado: {status}</Text>
      <Text style={styles.idText}>Tu ID: {clientId.current}</Text>
      
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="ID del destinatario"
          value={targetInput}
          onChangeText={setTargetInput}
          editable={!isCalling}
        />
      </View>

      <View style={styles.buttonContainer}>
        <Button
          title={isCalling ? 'Finalizar Llamada' : 'Iniciar Llamada'}
          onPress={isCalling ? stopCall : startCall}
          disabled={!wsConnected || (isCalling ? false : !targetInput)}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  statusText: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
  idText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
    color: '#666',
  },
  inputContainer: {
    marginBottom: 20,
  },
  input: {
    height: 40,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 10,
    backgroundColor: 'white',
  },
  buttonContainer: {
    marginBottom: 20,
  },
});

export default WebRTCAudioApp;