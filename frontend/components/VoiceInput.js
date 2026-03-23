import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000';

const VoiceInput = forwardRef(function VoiceInput(
  { onTranscriptReady, onListeningChange, autoStartSignal = 0 },
  ref
) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const peerConnectionRef = useRef(null);
  const dataChannelRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const manualStopRef = useRef(false);
  const transcriptRef = useRef('');

  const closeSession = () => {
    if (dataChannelRef.current) {
      try {
        dataChannelRef.current.close();
      } catch (_error) {
        // no-op
      }
      dataChannelRef.current = null;
    }

    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch (_error) {
        // no-op
      }
      peerConnectionRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  };

  const finishListening = () => {
    setIsListening(false);
    if (onListeningChange) {
      onListeningChange(false);
    }
  };

  const handleTranscriptComplete = (finalTranscript) => {
    transcriptRef.current = finalTranscript.trim();
    setTranscript(transcriptRef.current);
    finishListening();
    closeSession();

    if (!manualStopRef.current && transcriptRef.current) {
      onTranscriptReady(transcriptRef.current);
    }

    manualStopRef.current = false;
  };

  const startRealtimeTranscription = async () => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      setIsSupported(false);
      return;
    }

    manualStopRef.current = false;
    transcriptRef.current = '';
    setTranscript('');
    setErrorMessage('');
    setIsListening(true);
    if (onListeningChange) {
      onListeningChange(true);
    }

    try {
      const peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      mediaStreamRef.current = mediaStream;
      mediaStream.getTracks().forEach((track) => peerConnection.addTrack(track, mediaStream));

      const dataChannel = peerConnection.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;

      dataChannel.addEventListener('message', (event) => {
        let message;

        try {
          message = JSON.parse(event.data);
        } catch (_error) {
          return;
        }

        if (message.type === 'conversation.item.input_audio_transcription.delta') {
          transcriptRef.current = `${transcriptRef.current}${message.delta || ''}`;
          setTranscript(transcriptRef.current.trim());
        }

        if (message.type === 'conversation.item.input_audio_transcription.segment') {
          transcriptRef.current = message.text || transcriptRef.current;
          setTranscript(transcriptRef.current.trim());
        }

        if (message.type === 'conversation.item.input_audio_transcription.completed') {
          handleTranscriptComplete(message.transcript || transcriptRef.current);
        }

        if (message.type === 'input_audio_buffer.speech_started') {
          setTranscript('');
          transcriptRef.current = '';
        }

        if (message.type === 'error') {
          setErrorMessage(message.error?.message || 'Realtime transcription failed.');
        }
      });

      dataChannel.addEventListener('close', () => {
        finishListening();
      });

      dataChannel.addEventListener('error', () => {
        setErrorMessage('Realtime transcription channel closed unexpectedly.');
      });

      peerConnection.addEventListener('connectionstatechange', () => {
        if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected') {
          setErrorMessage('Microphone connection was interrupted.');
        }
      });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const sdpResponse = await fetch(`${API_BASE_URL}/realtime/transcription-session`, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          'Content-Type': 'application/sdp'
        }
      });

      if (!sdpResponse.ok) {
        throw new Error('Failed to start realtime transcription session.');
      }

      const answer = {
        type: 'answer',
        sdp: await sdpResponse.text()
      };

      await peerConnection.setRemoteDescription(answer);
    } catch (error) {
      closeSession();
      finishListening();
      setErrorMessage(error?.message || 'Failed to start realtime transcription session.');
    }
  };

  useImperativeHandle(ref, () => ({
    startListening() {
      if (!isListening) {
        startRealtimeTranscription();
      }
    },
    stopListening() {
      manualStopRef.current = true;
      closeSession();
      finishListening();
    }
  }), [isListening]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      setIsSupported(false);
    }

    return () => {
      closeSession();
    };
  }, []);

  useEffect(() => {
    if (!autoStartSignal || isListening) {
      return;
    }

    startRealtimeTranscription();
  }, [autoStartSignal, isListening]);

  return (
    <div className="card voiceCard">
      {!isSupported && (
        <p className="helpText">
          Realtime transcription is not supported in this browser.
        </p>
      )}

      {errorMessage && isSupported && (
        <p className="helpText">
          {errorMessage}
        </p>
      )}

      {transcript && (
        <div className="transcriptBox">
          <p>{transcript}</p>
        </div>
      )}
    </div>
  );
});

export default VoiceInput;
