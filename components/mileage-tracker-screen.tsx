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
  ArrowLeft,
  MapPin,
  Plus,
  Trash2,
  Loader2,
  Car,
  Calendar,
  AlertCircle,
} from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/firebase/api-client";

const IRS_STANDARD_MILEAGE_RATE = 0.67;

interface MileageTrip {
  id: string;
  userId: string;
  date: string;
  startLocation: string;
  endLocation: string;
  miles: number;
  businessPurpose: string;
  roundTrip: boolean;
}

interface MileageTrackerScreenProps {
  user: { id: string; email?: string };
  onBack: () => void;
}

function getEffectiveMiles(trip: MileageTrip): number {
  return trip.roundTrip ? trip.miles * 2 : trip.miles;
}

function getDeductionAmount(miles: number): number {
  return miles * IRS_STANDARD_MILEAGE_RATE;
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

  const fetchTrips = useCallback(async () => {
    try {
      const res = await makeAuthenticatedRequest(
        `/api/mileage?userId=${encodeURIComponent(user.id)}`
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
      setDate(new Date().toISOString().split("T")[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add trip");
    } finally {
      setIsSubmitting(false);
    }
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

  const currentYear = new Date().getFullYear();
  const yearTrips = trips.filter((t) => {
    const d = new Date(t.date);
    return !isNaN(d.getTime()) && d.getFullYear() === currentYear;
  });
  const totalMiles = yearTrips.reduce((sum, t) => sum + getEffectiveMiles(t), 0);
  const totalDeduction = getDeductionAmount(totalMiles);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <Button
              onClick={onBack}
              variant="ghost"
              size="icon"
              className="shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-lg sm:text-xl font-semibold text-foreground">
                Mileage Tracker
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Track business miles for tax deductions
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
        {/* Summary Card */}
        <Card className="bg-card border border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium text-foreground flex items-center gap-2">
              <Car className="w-4 h-4" />
              {currentYear} Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-lg bg-muted/50 p-3 sm:p-4">
                <p className="text-xs text-muted-foreground mb-0.5">
                  Total Business Miles
                </p>
                <p className="text-lg sm:text-xl font-semibold text-foreground">
                  {totalMiles.toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 sm:p-4">
                <p className="text-xs text-muted-foreground mb-0.5">
                  Total Deduction
                </p>
                <p className="text-lg sm:text-xl font-semibold text-foreground">
                  ${totalDeduction.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  @ ${IRS_STANDARD_MILEAGE_RATE}/mi (IRS 2024)
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 sm:p-4">
                <p className="text-xs text-muted-foreground mb-0.5">
                  Trips Logged
                </p>
                <p className="text-lg sm:text-xl font-semibold text-foreground">
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

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full grid grid-cols-2 bg-muted">
            <TabsTrigger value="trips">Trip Log</TabsTrigger>
            <TabsTrigger value="add">Add Trip</TabsTrigger>
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
                  <div className="flex justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  </div>
                ) : trips.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <MapPin className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">No trips logged yet.</p>
                    <p className="text-xs mt-1">
                      Add your first trip in the &quot;Add Trip&quot; tab.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {trips.map((trip) => {
                      const effectiveMiles = getEffectiveMiles(trip);
                      const deduction = getDeductionAmount(effectiveMiles);
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
                                ${deduction.toFixed(2)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                deduction
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

          <TabsContent value="add" className="mt-4">
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
                        className="mt-1"
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
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="startLocation">Start location</Label>
                    <Input
                      id="startLocation"
                      type="text"
                      placeholder="e.g. Home, Office"
                      value={startLocation}
                      onChange={(e) => setStartLocation(e.target.value)}
                      className="mt-1"
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
                      className="mt-1"
                    />
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
                      className="mt-1"
                    />
                  </div>

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
                    className="w-full sm:w-auto"
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
