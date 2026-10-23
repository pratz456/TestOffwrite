"use client";

import React, { useCallback, useEffect, useState } from 'react';
import { VehicleCards } from '@/components/mileage/vehicle-cards';
import { makeAuthenticatedRequest } from '@/lib/firebase/api-client';
import { MILEAGE_VEHICLE_COPY } from '@/lib/mileage/vehicle-copy';
import type { VehiclePatch, VehicleRecord } from '@/lib/mileage/vehicles';

export function VehicleDeductionBlock({ userId, taxYear }: { userId: string; taxYear: number }) {
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await makeAuthenticatedRequest(`/api/mileage/vehicles?userId=${encodeURIComponent(userId)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(body.vehicles)) throw new Error(MILEAGE_VEHICLE_COPY.loadFailed);
      setVehicles(body.vehicles as VehicleRecord[]);
      setLoadError('');
    } catch {
      setLoadError(MILEAGE_VEHICLE_COPY.loadFailed);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const onChange = async (vehicleId: string, patch: VehiclePatch) => {
    const response = await makeAuthenticatedRequest(`/api/mileage/vehicles/${encodeURIComponent(vehicleId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ userId, taxYear, ...patch }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setErrors(current => ({ ...current, [vehicleId]: typeof body.error === 'string' ? body.error : MILEAGE_VEHICLE_COPY.saveFailed }));
      return;
    }
    setErrors(current => ({ ...current, [vehicleId]: '' }));
    if (body.vehicle) setVehicles(current => current.map(vehicle => vehicle.id === vehicleId ? body.vehicle as VehicleRecord : vehicle));
  };

  const onAdd = async () => {
    const response = await makeAuthenticatedRequest('/api/mileage/vehicles', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.vehicle) {
      setLoadError(typeof body.error === 'string' ? body.error : MILEAGE_VEHICLE_COPY.addFailed);
      return;
    }
    setVehicles(current => [...current, body.vehicle as VehicleRecord]);
  };

  return (
    <div className="space-y-2">
      {loadError ? <p role="alert" className="text-sm text-destructive">{loadError}</p> : null}
      <VehicleCards copyEnabled vehicles={vehicles} taxYear={taxYear} errors={errors} onChange={onChange} onAdd={onAdd} />
    </div>
  );
}
