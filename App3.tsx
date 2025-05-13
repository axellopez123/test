import { useState, useEffect } from 'react';
import { Button, View, Text } from 'react-native';
import AudioRecord from 'react-native-audio-record';
import { Buffer } from 'buffer';

// const App = () => {
function App(): React.JSX.Element {

  // const App = ({ clientId }) => {
    const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [socket, setSocket] = useState(null);
  const [status, setStatus] = useState('Desconectado');

  useEffect(() => {
    const ws = new WebSocket(`wss://ventaja-backend.arwax.pro/ws/audio/1`);
    
    ws.onopen = () => {
      setIsConnected(true);
      setStatus('Conectado');
      setSocket(ws);
    };
    
    ws.onerror = (e) => {
      setStatus(`Error: ${e.message}`);
      console.error('WebSocket error:', e);
    };
    
    ws.onclose = () => {
      setIsConnected(false);
      setStatus('Desconectado');
      setSocket(null);
    };
    
    ws.onmessage = (msg) => {
      console.log('Mensaje del servidor:', msg.data);
      setStatus(`Servidor: ${msg.data}`);
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, []);
// }, [clientId]);

  const startRecording = async () => {
    if (!isConnected) return;
    
    const options = {
      sampleRate: 44100,
      channels: 1,
      bitsPerSample: 16,
      audioSource: 6,
    };
    
    AudioRecord.init(options);
    AudioRecord.start();
    setIsRecording(true);
    setStatus('Grabando...');
    
    AudioRecord.on('data', data => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        // socket.send(data);
        const audioBuffer = Buffer.from(data, 'base64');
        socket.send(audioBuffer); 
      }
    });
  };

  const stopRecording = () => {
    AudioRecord.stop();
    setIsRecording(false);
    setStatus('Conectado (en espera)');
  };

  return (
    <View>
      <Text>Estado: {status}</Text>
      <Button
        title={isRecording ? 'Detener Grabación' : 'Iniciar Grabación'}
        onPress={isRecording ? stopRecording : startRecording}
        disabled={!isConnected}
      />
    </View>
  );
};

export default App;
