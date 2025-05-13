import { useState, useEffect } from 'react';
import { Button, View, Text } from 'react-native';
import { RTCPeerConnection, RTCSessionDescription, mediaDevices } from 'react-native-webrtc';

function App(): React.JSX.Element {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [peerConnection, setPeerConnection] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [status, setStatus] = useState('Desconectado');

  // Configuración del servidor de señalización (WebSocket para intercambiar SDP/ICE)
  const signalingServer = new WebSocket('wss://ventaja-backend.arwax.pro/ws/signal');

  useEffect(() => {
    signalingServer.onmessage = async (message) => {
      const data = JSON.parse(message.data);

      if (data.type === 'offer') {
        // Crear respuesta a la oferta del servidor
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        signalingServer.send(JSON.stringify(answer));
      } else if (data.type === 'ice-candidate') {
        // Añadir candidato ICE
        await peerConnection.addIceCandidate(data.candidate);
      }
    };

    return () => {
      if (signalingServer.readyState === WebSocket.OPEN) {
        signalingServer.close();
      }
    };
  }, []);

  const setupWebRTC = async () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signalingServer.send(JSON.stringify({
          type: 'ice-candidate',
          candidate: event.candidate,
        }));
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setIsConnected(true);
        setStatus('Conectado via WebRTC');
      } else if (pc.connectionState === 'disconnected') {
        setIsConnected(false);
        setStatus('Desconectado');
      }
    };

    setPeerConnection(pc);
  };

  const startRecording = async () => {
    if (!peerConnection) await setupWebRTC();

    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });

    stream.getTracks().forEach(track => {
      peerConnection.addTrack(track, stream);
    });

    setLocalStream(stream);
    setIsRecording(true);
    setStatus('Transmitiendo audio...');
  };

  const stopRecording = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    setIsRecording(false);
    setStatus('Conectado (en espera)');
  };

  return (
    <View>
      <Text>Estado: {status}</Text>
      <Button
        title={isRecording ? 'Detener Transmisión' : 'Iniciar Transmisión'}
        onPress={isRecording ? stopRecording : startRecording}
      />
    </View>
  );
}

export default App;