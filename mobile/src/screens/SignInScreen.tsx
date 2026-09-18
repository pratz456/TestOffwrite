import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { isFirebaseConfigured, signInWithEmail } from '../auth/firebase';

export function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithEmail(email, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>WriteOff</Text>
      <Text style={styles.subtitle}>Track business mileage and receipts. Review every suggestion before it counts.</Text>
      {!isFirebaseConfigured() && (
        <Text accessibilityRole="alert" style={styles.error}>
          This build is missing its Firebase project configuration. Set the EXPO_PUBLIC_FIREBASE_* variables.
        </Text>
      )}
      <TextInput
        accessibilityLabel="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder="Email"
        style={styles.input}
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        accessibilityLabel="Password"
        autoComplete="password"
        placeholder="Password"
        secureTextEntry
        style={styles.input}
        value={password}
        onChangeText={setPassword}
      />
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      <Pressable accessibilityRole="button" disabled={busy || !email || !password} onPress={submit} style={[styles.button, (busy || !email || !password) && styles.buttonDisabled]}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
      </Pressable>
      <Text style={styles.footnote}>Create your account and verify your email on the web first. Plans are managed on the web, not in this app.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: '#fff' },
  title: { fontSize: 32, fontWeight: '700' },
  subtitle: { fontSize: 15, color: '#475569', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, padding: 14, fontSize: 16, minHeight: 48 },
  button: { backgroundColor: '#2563eb', borderRadius: 12, padding: 14, alignItems: 'center', minHeight: 48 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#b91c1c' },
  footnote: { color: '#64748b', fontSize: 12, marginTop: 8 },
});
