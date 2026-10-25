import React from 'react';
import { Button } from '@/components/ui/button';
import {
  LISTED_EQUIPMENT_KIND_NEITHER_PLACEHOLDER,
  LISTED_EQUIPMENT_KIND_NOTE_PLACEHOLDER,
  LISTED_EQUIPMENT_KIND_PHOTO_PLACEHOLDER,
  LISTED_EQUIPMENT_KIND_RECREATION_PLACEHOLDER,
  listedEquipmentFollowUpNeededCopy,
  listedEquipmentKindNeededCopy,
  listedEquipmentLocationNeededCopy,
  listedEquipmentMainLineNeededCopy,
  type ListedEquipmentHeldAsset,
} from '@/lib/reports/calc4562';

function questionCopy(asset: Pick<ListedEquipmentHeldAsset, 'name' | 'ask'>): string {
  if (asset.ask === 'main_line') return listedEquipmentMainLineNeededCopy(asset.name);
  if (asset.ask === 'follow_up') return listedEquipmentFollowUpNeededCopy(asset.name);
  if (asset.ask === 'location') return listedEquipmentLocationNeededCopy(asset.name);
  return listedEquipmentKindNeededCopy(asset.name);
}

/** The open question and the control that opens the asset. No dollar figure. */
export function ListedEquipmentKindPrompt({ assets }: { assets: readonly Pick<ListedEquipmentHeldAsset, 'id' | 'name' | 'ask'>[] }) {
  if (!assets.length) return null;
  return (
    <div className="space-y-3 text-left">
      {assets.map(asset => {
        const kindQuestion = asset.ask !== 'main_line' && asset.ask !== 'follow_up' && asset.ask !== 'location';
        return (
          <div key={asset.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-gray-800">
            <p>{questionCopy(asset)}</p>
            {kindQuestion && (
              <>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>{LISTED_EQUIPMENT_KIND_PHOTO_PLACEHOLDER}</li>
                  <li>{LISTED_EQUIPMENT_KIND_RECREATION_PLACEHOLDER}</li>
                  <li>{LISTED_EQUIPMENT_KIND_NEITHER_PLACEHOLDER}</li>
                </ul>
                <p className="mt-2 text-gray-600">{LISTED_EQUIPMENT_KIND_NOTE_PLACEHOLDER}</p>
              </>
            )}
            <Button asChild className="mt-3 min-h-11" variant="outline">
              <a href={`/protected/form4562?asset=${encodeURIComponent(asset.id)}`}>Answer now</a>
            </Button>
          </div>
        );
      })}
    </div>
  );
}
