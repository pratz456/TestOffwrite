import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { mobileAuth } from '../auth/firebase';
import { saveMileageTrip } from '../api/client';
import { isTripDetectionRunning, requestTripPermissions, startTripDetection, stopTripDetection } from '../trips/background-task';
import { localCalendarDay, type TripCandidate } from '../trips/geometry';
import { loadCandidates, removeCandidate } from '../trips/storage';

export function TripsScreen() {
  const [candidates, setCandidates] = useState<TripCandidate[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [permission, setPermission] = useState<'granted' | 'foreground-only' | 'denied' | 'unknown'>('unknown');
  const [purposes, setPurposes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setCandidates(await loadCandidates());
    setDetecting(await isTripDetectionRunning());
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggleDetection = async (enabled: boolean) => {
    if (!enabled) {
      await stopTripDetection();
      setDetecting(false);
      return;
    }
    const granted = await requestTripPermissions();
    setPermission(granted);
    if (granted === 'denied') {
      Alert.alert('Location permission needed', 'Allow location access to detect drives. You can still log trips manually on the web.');
      return;
    }
    if (granted === 'foreground-only') {
      Alert.alert('Background access not granted', 'Trips are only recorded while WriteOff is open. Choose "Always" in Settings for automatic detection.');
    }
    await startTripDetection();
    setDetecting(true);
  };

  const classify = async (candidate: TripCandidate, business: boolean) => {
    const purpose = (purposes[candidate.id] ?? '').trim();
    if (business && purpose.length < 8) {
      Alert.alert('Business purpose required', 'Describe the business reason for this drive (for example, "client meeting at Acme"). The IRS requires it for a mileage deduction.');
      return;
    }
    const user = mobileAuth().currentUser;
    if (!user) return;
    setBusyId(candidate.id);
    try {
      if (business) {
        await saveMileageTrip({
          userId: user.uid,
          date: localCalendarDay(candidate.startedAt),
          startLocation: `${candidate.start.latitude.toFixed(4)}, ${candidate.start.longitude.toFixed(4)}`,
          endLocation: `${candidate.end.latitude.toFixed(4)}, ${candidate.end.longitude.toFixed(4)}`,
          miles: candidate.miles,
          businessPurpose: purpose,
          roundTrip: false,
        });
      }
      // Personal drives are discarded locally and never leave the device.
      setCandidates(await removeCandidate(candidate.id));
    } catch (cause) {
      Alert.alert('Could not save trip', cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Detected drives</Text>
          <Text style={styles.subtitle}>
            {detecting ? 'Automatic detection is on.' : 'Automatic detection is off.'}
            {permission === 'foreground-only' ? ' Background access is limited.' : ''}
          </Text>
        </View>
        <Switch accessibilityLabel="Automatic trip detection" value={detecting} onValueChange={toggleDetection} />
      </View>
      <FlatList
        data={candidates}
        keyExtractor={candidate => candidate.id}
        onRefresh={refresh}
        refreshing={false}
        ListEmptyComponent={<Text style={styles.empty}>No drives waiting for review. Detected trips appear here for you to classify.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.miles.toFixed(1)} mi · {new Date(item.startedAt).toLocaleString()}</Text>
            <Text style={styles.cardMeta}>{Math.round((item.endedAt - item.startedAt) / 60000)} min · {item.sampleCount} GPS points</Text>
            <TextInput
              accessibilityLabel="Business purpose"
              placeholder="Business purpose (who / why)"
              style={styles.input}
              value={purposes[item.id] ?? ''}
              onChangeText={value => setPurposes(current => ({ ...current, [item.id]: value }))}
            />
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" disabled={busyId === item.id} onPress={() => classify(item, false)} style={[styles.action, styles.secondary]}>
                <Text style={styles.secondaryText}>Personal</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={busyId === item.id} onPress={() => classify(item, true)} style={[styles.action, styles.primary]}>
                <Text style={styles.primaryText}>Business</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  title: { fontSize: 20, fontWeight: '700' },
  subtitle: { color: '#64748b', fontSize: 13 },
  empty: { padding: 24, textAlign: 'center', color: '#64748b' },
  card: { margin: 12, padding: 14, backgroundColor: '#fff', borderRadius: 14, gap: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardMeta: { color: '#64748b', fontSize: 12 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 10, minHeight: 44 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, borderRadius: 10, padding: 12, alignItems: 'center', minHeight: 44 },
  primary: { backgroundColor: '#2563eb' },
  primaryText: { color: '#fff', fontWeight: '600' },
  secondary: { backgroundColor: '#e2e8f0' },
  secondaryText: { color: '#0f172a', fontWeight: '600' },
});
