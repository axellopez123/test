import React, { useEffect, useRef, useState } from 'react';
import { Button, View, PermissionsAndroid, Platform } from 'react-native';
import AudioRecord from 'react-native-audio-record';
import { Buffer } from 'buffer';

export default function App() {
  const [recording, setRecording] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    if (Platform.OS === 'android') {
      PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    }

    const options = {
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      audioSource: 6,
      wavFile: 'test.wav',
    };

    AudioRecord.init(options);

    AudioRecord.on('data', data => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        const chunk = Buffer.from(data, 'base64');
        socketRef.current.send(chunk);
      }
    });
  }, []);

  const startRecording = () => {
    const socket = new WebSocket('ws://ventaja-backend.arwax.pro/ws/audio'); // ← Reemplaza con tu IP
    socketRef.current = socket;

    socket.onopen = () => {
      console.log('✅ WebSocket conectado');
      AudioRecord.start();
      setRecording(true);
    };

    socket.onerror = err => console.error('❌ Error WebSocket:', err.message);
    socket.onclose = () => console.log('🔌 WebSocket cerrado');
  };

  const stopRecording = async () => {
    await AudioRecord.stop();
    socketRef.current?.close();
    setRecording(false);
    console.log('🛑 Grabación detenida');
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Button
        title={recording ? "Detener grabación" : "Iniciar grabación"}
        onPress={recording ? stopRecording : startRecording}
      />
    </View>
  );
}
