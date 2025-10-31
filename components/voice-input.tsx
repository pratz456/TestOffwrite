'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Mic, 
  MicOff, 
  Square, 
  Play, 
  Pause,
  Volume2,
  VolumeX,
  CheckCircle,
  AlertCircle,
  Loader2
} from 'lucide-react';

interface VoiceInputProps {
  onTranscript: (transcript: string) => void;
  onExpenseCreated?: (expense: any) => void;
  isOpen: boolean;
  onClose: () => void;
}

interface VoiceCommand {
  type: 'add_expense' | 'add_mileage' | 'question' | 'unknown';
  data: {
    amount?: number;
    merchant?: string;
    category?: string;
    purpose?: string;
    miles?: number;
    question?: string;
  };
  confidence: number;
}

export function VoiceInput({ onTranscript, onExpenseCreated, isOpen, onClose }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recognition, setRecognition] = useState<any>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [command, setCommand] = useState<VoiceCommand | null>(null);
  
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    // Check if speech recognition is supported
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        setIsSupported(true);
        const recognitionInstance = new SpeechRecognition();
        recognitionInstance.continuous = true;
        recognitionInstance.interimResults = true;
        recognitionInstance.lang = 'en-US';
        
        recognitionInstance.onstart = () => {
          setIsListening(true);
          setError(null);
          startAudioVisualization();
        };
        
        recognitionInstance.onresult = (event: any) => {
          let finalTranscript = '';
          let interimTranscript = '';
          
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript;
            } else {
              interimTranscript += transcript;
            }
          }
          
          if (finalTranscript) {
            setTranscript(prev => prev + finalTranscript);
            setInterimTranscript('');
            processVoiceCommand(finalTranscript);
          } else {
            setInterimTranscript(interimTranscript);
          }
        };
        
        recognitionInstance.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          setError(`Speech recognition error: ${event.error}`);
          setIsListening(false);
          stopAudioVisualization();
        };
        
        recognitionInstance.onend = () => {
          setIsListening(false);
          stopAudioVisualization();
        };
        
        setRecognition(recognitionInstance);
        recognitionRef.current = recognitionInstance;
      }
    }
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      stopAudioVisualization();
    };
  }, []);

  const startAudioVisualization = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);
      
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      
      const updateAudioLevel = () => {
        if (analyserRef.current && isListening) {
          analyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          setAudioLevel(average / 255);
          animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
        }
      };
      
      updateAudioLevel();
    } catch (error) {
      console.error('Error setting up audio visualization:', error);
    }
  };

  const stopAudioVisualization = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  };

  const processVoiceCommand = async (text: string) => {
    setIsProcessing(true);
    
    try {
      // Send to OpenAI for intent parsing
      const response = await fetch('/api/ai/parse-voice-command', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });
      
      if (response.ok) {
        const result = await response.json();
        setCommand(result.command);
        
        if (result.command.type === 'add_expense' && onExpenseCreated) {
          // Create expense from voice command
          const expense = {
            merchant_name: result.command.data.merchant || 'Voice Entry',
            amount: -Math.abs(result.command.data.amount || 0),
            category: result.command.data.category || 'other',
            date: new Date().toISOString().split('T')[0],
            description: text,
            notes: 'Created via voice input',
            is_deductible: true,
            analysis_status: 'completed'
          };
          
          onExpenseCreated(expense);
        }
      }
    } catch (error) {
      console.error('Error processing voice command:', error);
      setError('Failed to process voice command');
    } finally {
      setIsProcessing(false);
    }
  };

  const startListening = () => {
    if (recognitionRef.current && !isListening) {
      setTranscript('');
      setInterimTranscript('');
      setError(null);
      setCommand(null);
      recognitionRef.current.start();
    }
  };

  const stopListening = () => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();
    }
  };

  const clearTranscript = () => {
    setTranscript('');
    setInterimTranscript('');
    setCommand(null);
  };

  if (!isOpen) return null;

  if (!isSupported) {
    return (
      <Card className="fixed inset-4 z-50 max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-500" />
            Voice Input Not Supported
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Your browser doesn't support speech recognition. Please use Chrome, Safari, or Edge.
          </p>
          <Button onClick={onClose} className="w-full">
            Close
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="fixed inset-4 z-50 max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-teal-600" />
            Voice Input
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ×
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Audio Level Visualization */}
        <div className="flex justify-center">
          <div className="relative w-24 h-24 rounded-full border-4 border-gray-200 flex items-center justify-center">
            <div 
              className="absolute inset-0 rounded-full bg-teal-500 opacity-20 transition-all duration-100"
              style={{ 
                transform: `scale(${1 + audioLevel * 0.5})`,
                opacity: isListening ? 0.3 + audioLevel * 0.4 : 0
              }}
            />
            {isListening ? (
              <Mic className="h-8 w-8 text-teal-600 animate-pulse" />
            ) : (
              <MicOff className="h-8 w-8 text-gray-400" />
            )}
          </div>
        </div>

        {/* Status */}
        <div className="text-center">
          {isListening && (
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
              Listening...
            </Badge>
          )}
          {isProcessing && (
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Processing...
            </Badge>
          )}
          {error && (
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
              <AlertCircle className="h-3 w-3 mr-1" />
              Error
            </Badge>
          )}
        </div>

        {/* Transcript */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Transcript:</label>
          <div className="min-h-[100px] p-3 bg-gray-50 rounded-lg border">
            <p className="text-sm">
              {transcript}
              {interimTranscript && (
                <span className="text-gray-500 italic">{interimTranscript}</span>
              )}
            </p>
          </div>
        </div>

        {/* Command Result */}
        {command && (
          <div className="p-3 bg-teal-50 rounded-lg border border-teal-200">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="h-4 w-4 text-teal-600" />
              <span className="text-sm font-medium text-teal-800">Command Detected</span>
            </div>
            <p className="text-sm text-teal-700">
              {command.type === 'add_expense' && `Add expense: $${command.data.amount} at ${command.data.merchant}`}
              {command.type === 'add_mileage' && `Add mileage: ${command.data.miles} miles`}
              {command.type === 'question' && `Question: ${command.data.question}`}
            </p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-50 rounded-lg border border-red-200">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Controls */}
        <div className="flex gap-2">
          {!isListening ? (
            <Button 
              onClick={startListening} 
              className="flex-1 bg-teal-600 hover:bg-teal-700"
              disabled={isProcessing}
            >
              <Mic className="h-4 w-4 mr-2" />
              Start Listening
            </Button>
          ) : (
            <Button 
              onClick={stopListening} 
              variant="outline" 
              className="flex-1"
            >
              <Square className="h-4 w-4 mr-2" />
              Stop
            </Button>
          )}
          
          <Button 
            onClick={clearTranscript} 
            variant="outline"
            disabled={isListening || isProcessing}
          >
            Clear
          </Button>
        </div>

        {/* Instructions */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p><strong>Try saying:</strong></p>
          <p>• "Add $45 Starbucks meeting expense"</p>
          <p>• "Log 25 miles business trip"</p>
          <p>• "Can I deduct my home office?"</p>
        </div>
      </CardContent>
    </Card>
  );
}

// Extend Window interface for speech recognition
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}
