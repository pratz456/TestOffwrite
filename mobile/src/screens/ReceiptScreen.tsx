import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { commitReceipt, scanReceipt } from '../api/client';

type Draft = { merchant: string; amount: string; date: string; category: string };

export function ReceiptScreen() {
  const [image, setImage] = useState<{ uri: string; mimeType: string } | null>(null);
  const [draft, setDraft] = useState<Draft>({ merchant: '', amount: '', date: '', category: 'other' });
  const [confidence, setConfidence] = useState<number | null>(null);
  const [busy, setBusy] = useState<'scan' | 'save' | null>(null);

  const pick = async (fromCamera: boolean) => {
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8, mediaTypes: ['images'] })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, mediaTypes: ['images'] });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? 'image/jpeg';
    setImage({ uri: asset.uri, mimeType });
    setBusy('scan');
    try {
      const scanned = await scanReceipt(asset.uri, mimeType);
      setDraft({
        merchant: scanned.ocrResult.merchant || '',
        amount: scanned.ocrResult.amount ? String(scanned.ocrResult.amount) : '',
        // A missing date stays blank so the user enters the real purchase date.
        date: scanned.ocrResult.date || '',
        category: scanned.ocrResult.category || 'other',
      });
      setConfidence(scanned.ocrResult.confidence);
    } catch (cause) {
      Alert.alert('Could not read the receipt', cause instanceof Error ? cause.message : 'Enter the details manually.');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!image) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
      Alert.alert('Date required', 'Enter the purchase date as YYYY-MM-DD.');
      return;
    }
    setBusy('save');
    try {
      await commitReceipt(image.uri, image.mimeType, { ...draft, receiptType: 'expense' });
      Alert.alert('Saved', 'The receipt was saved as an expense awaiting your category and tax review.');
      setImage(null);
      setDraft({ merchant: '', amount: '', date: '', category: 'other' });
      setConfidence(null);
    } catch (cause) {
      Alert.alert('Could not save', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Capture a receipt</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={() => pick(true)} style={[styles.action, styles.primary]}><Text style={styles.primaryText}>Camera</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => pick(false)} style={[styles.action, styles.secondary]}><Text style={styles.secondaryText}>Photo library</Text></Pressable>
      </View>
      {image && <Image accessibilityLabel="Selected receipt" source={{ uri: image.uri }} style={styles.preview} resizeMode="contain" />}
      {busy === 'scan' && <ActivityIndicator />}
      {image && busy !== 'scan' && (
        <View style={styles.form}>
          {confidence !== null && <Text style={styles.meta}>Text recognition confidence {Math.round(confidence * 100)}%. Check every field before saving.</Text>}
          <TextInput accessibilityLabel="Merchant" placeholder="Merchant" style={styles.input} value={draft.merchant} onChangeText={merchant => setDraft(d => ({ ...d, merchant }))} />
          <TextInput accessibilityLabel="Amount in USD" placeholder="Amount (USD)" keyboardType="decimal-pad" style={styles.input} value={draft.amount} onChangeText={amount => setDraft(d => ({ ...d, amount }))} />
          <TextInput accessibilityLabel="Purchase date" placeholder="Date (YYYY-MM-DD)" style={styles.input} value={draft.date} onChangeText={date => setDraft(d => ({ ...d, date }))} />
          <Pressable accessibilityRole="button" disabled={busy === 'save'} onPress={save} style={[styles.action, styles.primary]}>
            {busy === 'save' ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Save as expense</Text>}
          </Pressable>
          <Text style={styles.meta}>Saving records the purchase. Whether it is deductible is decided in review, not by the scan.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, borderRadius: 10, padding: 12, alignItems: 'center', minHeight: 44 },
  primary: { backgroundColor: '#2563eb' },
  primaryText: { color: '#fff', fontWeight: '600' },
  secondary: { backgroundColor: '#e2e8f0' },
  secondaryText: { color: '#0f172a', fontWeight: '600' },
  preview: { width: '100%', height: 260, borderRadius: 12, backgroundColor: '#e2e8f0' },
  form: { gap: 10 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12, minHeight: 44, backgroundColor: '#fff' },
  meta: { color: '#64748b', fontSize: 12 },
});
