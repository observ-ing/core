// The batch uploader on a phone (#887): the same batch state as the desktop
// page, worked through full-screen steps in place of a grid with a side panel.
// Which observations are open for editing lives in the URL's query, so the
// phone's back button steps out of a screen rather than off the page.
import { useEffect, useState, type Dispatch } from "react";
import { useSearchParams } from "react-router-dom";
import type { BatchAction, BatchObservation } from "../../../lib/batchUpload";
import { PhoneGrid } from "./PhoneGrid";
import { PhoneStart } from "./PhoneStart";
import { PhoneUploadList } from "./PhoneUploadList";

export interface PhoneBatchProps {
  /** Every observation still to be sent, in batch order. */
  observations: BatchObservation[];
  selected: string[];
  uploadedCount: number;
  uploading: boolean;
  /** HEIC photos still being converted. */
  converting: number;
  /** Nothing can be sent yet, for a reason the observations don't show. */
  blocked: boolean;
  /** Picked photos arrive without their GPS position (see PhoneStart). */
  stripsLocation: boolean;
  /** Where the uploaded observations can be seen. */
  profilePath: string;
  dispatch: Dispatch<BatchAction>;
  /** Opens the photo picker; the photos join `target` when given. */
  onChoosePhotos: (target?: BatchObservation) => void;
  onUpload: (targets: BatchObservation[]) => void;
  onCancelUpload: () => void;
  onRemove: (observation: BatchObservation) => void;
  onRemoveSelected: () => void;
}

export function PhoneBatch({
  observations,
  selected,
  uploadedCount,
  uploading,
  converting,
  blocked,
  stripsLocation,
  profilePath,
  dispatch,
  onChoosePhotos,
  onUpload,
  onCancelUpload,
  onRemove,
  onRemoveSelected,
}: PhoneBatchProps) {
  const [params, setParams] = useSearchParams();
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  const editIds = (params.get("edit") ?? "").split(",").filter(Boolean);
  const editing = uploading ? [] : observations.filter((o) => editIds.includes(o.id));

  const open = (ids: string[]) => setParams({ edit: ids.join(",") });

  // An address naming observations that aren't there (a reload, or one that
  // was just removed) is the grid's.
  const stale = editIds.length > 0 && editing.length === 0 && !uploading;
  useEffect(() => {
    if (stale) setParams({}, { replace: true });
  }, [stale, setParams]);

  const failed = observations.filter((o) => o.status === "failed");

  return (
    <>
      {observations.length === 0 ? (
        <PhoneStart
          onChoosePhotos={() => onChoosePhotos()}
          converting={converting}
          stripsLocation={stripsLocation}
        />
      ) : uploading || failed.length === observations.length ? (
        <PhoneUploadList
          observations={observations}
          uploadedCount={uploadedCount}
          uploading={uploading}
          blocked={blocked}
          profilePath={profilePath}
          onCancel={onCancelUpload}
          onEdit={(id) => open([id])}
          onRetry={(o) => onUpload([o])}
          onRetryAll={() => onUpload(observations)}
          onRemove={onRemove}
        />
      ) : (
        <PhoneGrid
          observations={observations}
          selected={selected}
          onlyIncomplete={onlyIncomplete}
          onFilter={setOnlyIncomplete}
          converting={converting}
          blocked={blocked}
          onOpen={(id) => open([id])}
          onToggle={(id) => dispatch({ type: "select", id, additive: true })}
          onSelectAll={(ids) => dispatch({ type: "selectAll", ids })}
          onClearSelection={() => dispatch({ type: "clearSelection" })}
          onAddPhotos={() => onChoosePhotos()}
          onUpload={() => onUpload(observations)}
          onEditSelected={() => open(selected)}
          onCombine={() => dispatch({ type: "combineSelected" })}
          onSplit={() => dispatch({ type: "splitSelected" })}
          onRemoveSelected={onRemoveSelected}
        />
      )}
    </>
  );
}
