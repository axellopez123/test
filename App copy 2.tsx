import React, { useState, useEffect } from 'react';
import { View, Button, PermissionsAndroid } from 'react-native';
import AudioRecord from 'react-native-audio-record';
import { io } from 'socket.io-client';

const App = () => {
  const [recording, setRecording] = useState(false);
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Configurar el socket
    const newSocket = io('ws://ventaja-backend.arwax.pro/ws/audio', {
      transports: ['websocket'],
      forceNew: true,
    });

    newSocket.on('connect', () => {
      console.log('Conectado al servidor WebSocket');
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Desconectado del servidor WebSocket');
      setIsConnected(false);
    });

    setSocket(newSocket);

    // Configurar audio
    const audioOptions = {
      sampleRate: 44100,  // Asegúrate que coincida con el servidor
      channels: 1,
      bitsPerSample: 16,
      audioSource: 6,
      wavFile: 'audio_stream.wav'
    };

    AudioRecord.init(audioOptions);

    return () => {
      newSocket.disconnect();
      AudioRecord.stop();
    };
  }, []);

  const requestPermission = async () => {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Permiso de Microfono',
          message: 'La app necesita acceso a tu microfono',
          buttonNeutral: 'Preguntar después',
          buttonNegative: 'Cancelar',
          buttonPositive: 'OK',
        },
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  const startRecording = async () => {
    const hasPermission = await requestPermission();
    if (!hasPermission || !isConnected) return;

    setRecording(true);
    AudioRecord.start();
    
    AudioRecord.on('data', (data) => {
      if (socket && isConnected) {
        socket.emit('audio_chunk', data);
      }
    });
  };

  const stopRecording = () => {
    setRecording(false);
    AudioRecord.stop();
  };

  return (
    <View>
      <Button
        title={recording ? 'Detener Grabación' : 'Iniciar Grabación'}
        onPress={recording ? stopRecording : startRecording}
        disabled={!isConnected}
      />
    </View>
  );
};

export default App;