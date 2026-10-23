"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  MapPin,
  Plus,
  Trash2,
  Loader2,
  Car,
  Calendar,
  AlertCircle,
} from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";
import { MileageUnsortedBanner, TripSortScreen } from "@/components/mileage/trip-sort-screen";
import { mileageVehicleCopyEnabled, MILEAGE_VEHICLE_COPY } from "@/lib/mileage/vehicle-copy";
import {
  applyHomeDestination,
  countedMiles,
  groupNeedsHomePrompt,
  groupTrips,
  normalizeStoredTrip,
  sortFinished,
  sortProgress,
  tripStartsAtHome,
  type HomeDestination,
  type MileageTripFields,
  type TripType,
  type VehiclePatch,
  type VehicleRecord,
  type YesNo,
} from "@/lib/mileage/vehicles";
import { businessMileageRateForDate, summarizeBusinessMileage } from "@/lib/tax-rules/mileage-rates";

interface MileageTrip {
  id: string;
  userId: string;
  date: string;
  startLocation: string;
  endLocation: string;
  miles: number;
  businessPurpose: string;
  roundTrip: boolean;
  vehicleId?: string | null;
  tripType?: TripType | null;
  homeDestination?: HomeDestination | null;
}

interface MileageTrackerScreenProps {
  user: { id: string; email?: string };
  onBack: () => void;
}

function getEffectiveMiles(trip: MileageTrip): number {
  return trip.roundTrip ? trip.miles * 2 : trip.miles;
}

function getDeductionAmount(trip: MileageTrip): number | null {
  const period = businessMileageRateForDate(trip.date);
  return period ? getEffectiveMiles(trip) * period.ratePerMile : null;
}

export function MileageTrackerScreen({ user, onBack }: MileageTrackerScreenProps) {
  const [trips, setTrips] = useState<MileageTrip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add trip form state
  const [date, setDate] = useState(() =>
    new Date().toISOString().split("T")[0]
  );
  const [startLocation, setStartLocation] = useState("");
  const [endLocation, setEndLocation] = useState("");
  const [miles, setMiles] = useState("");
  const [businessPurpose, setBusinessPurpose] = useState("");
  const [roundTrip, setRoundTrip] = useState(false);
  const [activeTab, setActiveTab] = useState("trips");
  const [tripVehicleId, setTripVehicleId] = useState<string | null>(null);
  const [tripType, setTripType] = useState<TripType | null>(null);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [fiveAtOnce, setFiveAtOnce] = useState<YesNo | null>(null);
  const [vehicleErrors, setVehicleErrors] = useState<Record<string, string>>({});
  const [sorting, setSorting] = useState(false);
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);
  const [homePromptKey, setHomePromptKey] = useState<string | null>(null);
  const [homePromptTripId, setHomePromptTripId] = useState<string | null>(null);
  const [selectedVehicleByGroup, setSelectedVehicleByGroup] = useState<Record<string, string | null>>({});
  const [selectedTypeByGroup, setSelectedTypeByGroup] = useState<Record<string, TripType | "unsure" | null>>({});
  const copyEnabled = mileageVehicleCopyEnabled();

  const fetchTrips = useCallback(async () => {
    try {
      const res = await makeAuthenticatedRequest(
        `/api/mileage?userId=${encodeURIComponent(user.id)}${mileageVehicleCopyEnabled() ? "&year=all" : ""}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to fetch trips");
      }
      const data = await res.json();
      setTrips(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      console.error("Error fetching mileage trips:", err);
      setError(err instanceof Error ? err.message : "Failed to load trips");
      setTrips([]);
    } finally {
      setIsLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    fetchTrips();
  }, [fetchTrips]);

  const handleAddTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startLocation.trim() || !endLocation.trim() || !miles.trim()) {
      setError("Please fill in start location, end location, and miles.");
      return;
    }
    const milesNum = parseFloat(miles);
    if (isNaN(milesNum) || milesNum <= 0) {
      setError("Please enter a valid number of miles.");
      return;
    }
    if (copyEnabled && sortIsFinished && (!tripVehicleId || !tripType)) {
      setError(MILEAGE_VEHICLE_COPY.pickTripType);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await makeAuthenticatedRequest("/api/mileage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          date,
          startLocation: startLocation.trim(),
          endLocation: endLocation.trim(),
          miles: milesNum,
          businessPurpose: businessPurpose.trim(),
          roundTrip,
          ...(copyEnabled && sortIsFinished ? { vehicleId: tripVehicleId, tripType } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to add trip");
      }
      const newTrip = await res.json();
      setTrips((prev) => [newTrip, ...prev]);
      setStartLocation("");
      setEndLocation("");
      setMiles("");
      setBusinessPurpose("");
      setRoundTrip(false);
      setTripVehicleId(null);
      setTripType(null);
      setDate(new Date().toISOString().split("T")[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add trip");
    } finally {
      setIsSubmitting(false);
    }
  };

  const records: MileageTripFields[] = trips.map(trip => normalizeStoredTrip(trip));
  const progress = sortProgress(records);
  const grouped = groupTrips(records);
  const sortIsFinished = sortFinished(records);

  useEffect(() => {
    if (!copyEnabled) return;
    let cancelled = false;
    (async () => {
      const response = await makeAuthenticatedRequest(`/api/mileage/vehicles?userId=${encodeURIComponent(user.id)}`);
      const body = await response.json().catch(() => ({}));
      if (!cancelled && response.ok && Array.isArray(body.vehicles)) {
        setVehicles(body.vehicles as VehicleRecord[]);
        setFiveAtOnce(body.fiveAtOnce === "yes" || body.fiveAtOnce === "no" ? body.fiveAtOnce : null);
      }
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [copyEnabled, user.id]);

  const replaceTrips = (next: MileageTripFields[]) => {
    setTrips(current => current.map(trip => {
      const updated = next.find(item => item.id === trip.id);
      return updated ? { ...trip, ...updated } : trip;
    }));
  };

  const persistAssignments = async (updates: Array<{ tripId: string; vehicleId: string | null; tripType: TripType | null; homeDestination?: HomeDestination | null }>) => {
    const response = await makeAuthenticatedRequest("/api/mileage/assignments", {
      method: "POST",
      body: JSON.stringify({ userId: user.id, updates }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(body.trips)) {
      setError(typeof body.error === "string" ? body.error : MILEAGE_VEHICLE_COPY.sortFailed);
      return;
    }
    replaceTrips(body.trips as MileageTripFields[]);
    setError(null);
  };

  const saveVehicle = async (vehicleId: string, patch: VehiclePatch) => {
    const response = await makeAuthenticatedRequest(`/api/mileage/vehicles/${encodeURIComponent(vehicleId)}`, {
      method: "PATCH",
      body: JSON.stringify({ userId: user.id, taxYear: new Date().getFullYear(), ...patch }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.vehicle) {
      setVehicleErrors(current => ({ ...current, [vehicleId]: typeof body.error === "string" ? body.error : MILEAGE_VEHICLE_COPY.saveFailed }));
      return;
    }
    setVehicleErrors(current => ({ ...current, [vehicleId]: "" }));
    setVehicles(current => current.map(vehicle => vehicle.id === vehicleId ? body.vehicle as VehicleRecord : vehicle));
    if (body.fiveAtOnce === "yes" || body.fiveAtOnce === "no" || body.fiveAtOnce === null) setFiveAtOnce(body.fiveAtOnce);
  };

  const saveFiveAtOnce = (value: YesNo | null) => {
    const vehicleId = vehicles[0]?.id;
    if (!vehicleId) return;
    void saveVehicle(vehicleId, { fiveAtOnce: value });
  };

  const addVehicle = async () => {
    const response = await makeAuthenticatedRequest("/api/mileage/vehicles", {
      method: "POST",
      body: JSON.stringify({ userId: user.id }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.vehicle) {
      setError(typeof body.error === "string" ? body.error : MILEAGE_VEHICLE_COPY.addFailed);
      return;
    }
    setVehicles(current => [...current, body.vehicle as VehicleRecord]);
  };

  const handleDeleteTrip = async (tripId: string) => {
    try {
      const res = await makeAuthenticatedRequest(`/api/mileage/${tripId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete trip");
      setTrips((prev) => prev.filter((t) => t.id !== tripId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete trip");
    }
  };

  const groupByKey = (key: string) => [...grouped.repeated, ...grouped.oneOff].find(group => group.key === key);

  const onSelectType = (key: string, tripTypeValue: TripType | "unsure") => {
    const group = groupByKey(key);
    if (!group) return;
    const members = records.filter(trip => group.tripIds.includes(trip.id));
    setSelectedTypeByGroup(current => ({ ...current, [key]: tripTypeValue }));
    if (tripTypeValue === "commute" && groupNeedsHomePrompt(members)) {
      setHomePromptKey(key);
      return;
    }
    setHomePromptKey(current => current === key ? null : current);
    void persistAssignments(group.tripIds.map(tripId => ({
      tripId,
      vehicleId: selectedVehicleByGroup[key] ?? null,
      tripType: tripTypeValue === "unsure" ? null : tripTypeValue,
      homeDestination: null,
    })));
  };

  const onHomeChoice = (key: string, choice: HomeDestination) => {
    const group = groupByKey(key);
    if (!group) return;
    setHomePromptKey(null);
    void persistAssignments(group.tripIds.map(tripId => ({
      tripId,
      vehicleId: selectedVehicleByGroup[key] ?? null,
      tripType: applyHomeDestination(records.find(trip => trip.id === tripId) ?? records[0], choice).tripType,
      homeDestination: choice,
    })));
  };

  const onTripType = (tripId: string, tripTypeValue: TripType | "unsure") => {
    const trip = records.find(item => item.id === tripId);
    if (!trip) return;
    if (tripTypeValue === "commute" && tripStartsAtHome(trip.startLocation)) {
      setHomePromptTripId(tripId);
      setOpenGroupKey(groupTrips([trip]).oneOff[0]?.key ?? openGroupKey);
      return;
    }
    setHomePromptTripId(current => current === tripId ? null : current);
    void persistAssignments([{ tripId, vehicleId: trip.vehicleId, tripType: tripTypeValue === "unsure" ? null : tripTypeValue, homeDestination: null }]);
  };

  const onTripHomeChoice = (tripId: string, choice: HomeDestination) => {
    const trip = records.find(item => item.id === tripId);
    if (!trip) return;
    setHomePromptTripId(null);
    const classified = applyHomeDestination(trip, choice);
    void persistAssignments([{ tripId, vehicleId: trip.vehicleId, tripType: classified.tripType, homeDestination: choice }]);
  };

  const currentYear = new Date().getFullYear();
  const yearTrips = trips.filter((t) => {
    const d = new Date(t.date);
    return !isNaN(d.getTime()) && d.getFullYear() === currentYear;
  });
  const countedYearTrips = records.filter(trip => {
    const d = new Date(trip.date);
    return !isNaN(d.getTime()) && d.getFullYear() === currentYear;
  });
  const totalMiles = copyEnabled
    ? countedYearTrips.reduce((sum, trip) => sum + countedMiles(trip), 0)
    : yearTrips.reduce((sum, t) => sum + getEffectiveMiles(t), 0);
  const mileageSummary = summarizeBusinessMileage(copyEnabled
    ? countedYearTrips.filter(trip => countedMiles(trip) > 0).map(trip => ({ date: trip.date, miles: countedMiles(trip) }))
    : yearTrips.map(t => ({ date: t.date, miles: getEffectiveMiles(t) })));
  const totalDeduction = mileageSummary.deduction;
  const rateLabel = mileageSummary.ratesApplied.length
    ? `@ ${mileageSummary.ratesApplied.map(rate => `$${rate}`).join(' / ')}/mi (IRS ${currentYear})`
    : `IRS ${currentYear} rate not yet published`;

  return (
    <div className="min-h-full bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3 sm:gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                Mileage Tracker
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Track business miles for tax deductions
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Summary Card */}
        <Card className="bg-card border border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium text-foreground flex items-center gap-2">
              <Car className="w-4 h-4" />
              {currentYear} Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="rounded-lg bg-muted/50 p-3 sm:p-4">
                <p className="text-xs text-muted-foreground mb-0.5">
                  Total Business Miles
                </p>
                <p className="text-xl font-semibold tracking-tight text-foreground">
                  {totalMiles.toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 sm:p-4">
                <p className="text-xs text-muted-foreground mb-0.5">
                  Total Deduction
                </p>
                <p className="text-xl font-semibold tracking-tight text-foreground">
                  ${totalDeduction.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {rateLabel}
                  {mileageSummary.unratedTrips > 0 && ` · ${mileageSummary.unratedTrips} trip${mileageSummary.unratedTrips === 1 ? '' : 's'} awaiting a published rate`}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 sm:p-4">
                <p className="text-xs text-muted-foreground mb-0.5">
                  Trips Logged
                </p>
                <p className="text-xl font-semibold tracking-tight text-foreground">
                  {yearTrips.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        <MileageUnsortedBanner copyEnabled={copyEnabled} unsortedCount={progress.unsorted} onSort={() => setSorting(true)} />
        {copyEnabled && sorting ? (
          <TripSortScreen
            copyEnabled={copyEnabled}
            vehicles={vehicles}
            taxYear={currentYear}
            repeated={grouped.repeated}
            oneOff={grouped.oneOff}
            trips={records}
            done={progress.done}
            total={progress.total}
            openGroupKey={openGroupKey}
            homePromptKey={homePromptKey}
            homePromptTripId={homePromptTripId}
            selectedVehicleByGroup={selectedVehicleByGroup}
            selectedTypeByGroup={selectedTypeByGroup}
            vehicleErrors={vehicleErrors}
            fiveAtOnce={fiveAtOnce}
            onChangeVehicle={(vehicleId, patch) => { void saveVehicle(vehicleId, patch); }}
            onFiveAtOnce={saveFiveAtOnce}
            onAddVehicle={() => { void addVehicle(); }}
            onOpenGroup={key => setOpenGroupKey(current => current === key ? null : key)}
            onSelectVehicle={(key, vehicleId) => setSelectedVehicleByGroup(current => ({ ...current, [key]: vehicleId }))}
            onSelectType={onSelectType}
            onHomeChoice={onHomeChoice}
            onTripVehicle={(tripId, vehicleId) => {
              const trip = records.find(item => item.id === tripId);
              if (!trip) return;
              void persistAssignments([{ tripId, vehicleId, tripType: trip.tripType, homeDestination: trip.homeDestination }]);
            }}
            onTripType={onTripType}
            onTripHomeChoice={onTripHomeChoice}
          />
        ) : null}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="h-auto w-full grid grid-cols-2 bg-muted">
            <TabsTrigger value="trips" className="min-h-11">Trip Log</TabsTrigger>
            <TabsTrigger value="add" className="min-h-11">Add Trip</TabsTrigger>
          </TabsList>

          <TabsContent value="trips" className="mt-4">
            <Card className="bg-card border border-border">
              <CardHeader>
                <CardTitle className="text-base font-medium text-foreground">
                  Logged Trips
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex justify-center py-7">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  </div>
                ) : trips.length === 0 ? (
                  <div className="text-center py-7 text-muted-foreground">
                    <MapPin className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">No trips logged yet.</p>
                    <p className="text-xs mt-1">
                      Add your first trip in the &quot;Add Trip&quot; tab.
                    </p>
                  </div>
                ) : (
                  <div className="grid items-start gap-3 lg:grid-cols-2">
                    {trips.map((trip) => {
                      const effectiveMiles = getEffectiveMiles(trip);
                      const deduction = getDeductionAmount(trip);
                      return (
                        <div
                          key={trip.id}
                          className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 sm:p-4 rounded-lg border border-border bg-background/50 hover:bg-muted/30 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <span className="text-sm font-medium text-foreground">
                                {trip.startLocation} → {trip.endLocation}
                              </span>
                              {trip.roundTrip && (
                                <Badge variant="secondary" className="text-xs">
                                  Round trip
                                </Badge>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {new Date(trip.date).toLocaleDateString()}
                              </span>
                              <span>{effectiveMiles} mi</span>
                              {trip.businessPurpose && (
                                <span className="truncate max-w-[200px]">
                                  {trip.businessPurpose}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
                            <div className="text-right">
                              <p className="text-sm font-semibold text-foreground">
                                {deduction === null ? 'Rate pending' : `$${deduction.toFixed(2)}`}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {deduction === null ? 'IRS rate not yet published' : 'standard mileage'}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteTrip(trip.id)}
                              className="text-muted-foreground hover:text-destructive shrink-0"
                              aria-label="Delete trip"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="add" className="mt-4 max-w-4xl">
            <Card className="bg-card border border-border">
              <CardHeader>
                <CardTitle className="text-base font-medium text-foreground flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Add New Trip
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleAddTrip} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="date">Date</Label>
                      <Input
                        id="date"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="mt-1 min-h-11"
                      />
                    </div>
                    <div>
                      <Label htmlFor="miles">Miles driven</Label>
                      <Input
                        id="miles"
                        type="number"
                        step="0.1"
                        min="0"
                        placeholder="0"
                        value={miles}
                        onChange={(e) => setMiles(e.target.value)}
                        className="mt-1 min-h-11"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="startLocation">Start location</Label>
                    <Input
                      id="startLocation"
                      type="text"
                      placeholder="e.g. Home, Office"
                      value={startLocation}
                      onChange={(e) => setStartLocation(e.target.value)}
                      className="mt-1 min-h-11"
                    />
                  </div>

                  <div>
                    <Label htmlFor="endLocation">End location</Label>
                    <Input
                      id="endLocation"
                      type="text"
                      placeholder="e.g. Client office, Airport"
                      value={endLocation}
                      onChange={(e) => setEndLocation(e.target.value)}
                      className="mt-1 min-h-11"
                    />
                  </div>

                  </div>
                  <div>
                    <Label htmlFor="businessPurpose">
                      Business purpose
                    </Label>
                    <Input
                      id="businessPurpose"
                      type="text"
                      placeholder="e.g. Client meeting, Office pickup"
                      value={businessPurpose}
                      onChange={(e) => setBusinessPurpose(e.target.value)}
                      className="mt-1 min-h-11"
                    />
                  </div>

                  {copyEnabled && sortIsFinished ? (
                    <div className="space-y-3">
                      <p className="text-sm text-foreground">{MILEAGE_VEHICLE_COPY.pickTripType}</p>
                      <div className="flex flex-wrap gap-2">
                        {vehicles.map(vehicle => (
                          <button
                            key={vehicle.id}
                            type="button"
                            aria-pressed={tripVehicleId === vehicle.id}
                            className={`min-h-11 rounded-lg border px-3 text-sm ${tripVehicleId === vehicle.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}
                            onClick={() => setTripVehicleId(vehicle.id)}
                          >
                            {vehicle.name}
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {([
                          ["business", MILEAGE_VEHICLE_COPY.business],
                          ["commute", MILEAGE_VEHICLE_COPY.commute],
                          ["personal", MILEAGE_VEHICLE_COPY.personal],
                        ] as const).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={tripType === value}
                            className={`min-h-11 rounded-lg border px-3 text-sm ${tripType === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}
                            onClick={() => setTripType(value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between rounded-lg border border-border p-4 bg-muted/30">
                    <div className="space-y-0.5">
                      <Label htmlFor="roundTrip">Round trip</Label>
                      <p className="text-xs text-muted-foreground">
                        Double the miles for deduction
                      </p>
                    </div>
                    <Switch
                      checked={roundTrip}
                      onCheckedChange={setRoundTrip}
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="min-h-11 w-full sm:w-auto"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Adding...
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4 mr-2" />
                        Add Trip
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default MileageTrackerScreen;
