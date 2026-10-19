// The batch uploader on a phone (#887): the same batch state as the desktop
// page, worked through full-screen steps in place of a grid with a side panel.
// Which observation is open, and which of its fields, lives in the URL's query
// so the phone's back button steps out of a screen rather than off the page.
import { useEffect, useLayoutEffect, useRef, useState, type Dispatch } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Dialog } from "@mui/material";
import {
  describeMissing,
  isReading,
  missingFields,
  nextIncompleteId,
  type BatchAction,
  type BatchEdit,
  type BatchObservation,
  type BatchPhoto,
} from "../../../lib/batchUpload";
import { plural } from "../../../lib/utils";
import { DateFields, RemarksField } from "../BatchEditor";
import { PhoneEditor, type EditStep } from "./PhoneEditor";
import { PhoneGrid } from "./PhoneGrid";
import { PhoneLocationStep } from "./PhoneLocationStep";
import { PhonePhotos, type PhotoNotice } from "./PhonePhotos";
import { PhoneStart } from "./PhoneStart";
import { PhoneStep } from "./PhoneStep";
import { PhoneTaxonStep } from "./PhoneTaxonStep";
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
  /** A long press can drag a photo (see `useBatchLayout`). */
  touchDrag?: boolean;
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

/** A split or removal on the photos screen that can still be undone. */
interface Undoable {
  kind: "split" | "remove";
  /** The observation as it was, and where it sat in the batch. */
  before: BatchObservation;
  index: number;
  /**
   * Every observation there was. Any other one since that holds only photos
   * that left is the split's doing; one added meanwhile (e.g. a HEIC photo
   * that finished converting) is not.
   */
  knownIds: string[];
  /** The photos that left. A removed one's preview is freed once undo is off the table. */
  photos: BatchPhoto[];
  /**
   * The history entry of the photos screen it happened on. Undo is offered
   * there only: leaving the screen, by any route, keeps the change.
   */
  locationKey: string;
}

const STEPS: readonly EditStep[] = ["taxon", "date", "location", "remarks", "photos"];
const isStep = (value: string | null): value is EditStep => STEPS.some((step) => step === value);

export function PhoneBatch({
  observations,
  selected,
  uploadedCount,
  uploading,
  converting,
  blocked,
  stripsLocation,
  touchDrag = true,
  profilePath,
  dispatch,
  onChoosePhotos,
  onUpload,
  onCancelUpload,
  onRemove,
  onRemoveSelected,
}: PhoneBatchProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [lastChange, setLastChange] = useState<Undoable | null>(null);
  const undoable = lastChange?.locationKey === location.key ? lastChange : null;
  // A change whose screen was left, by any route, is kept for good: the
  // browser's Forward back to that screen mustn't offer undo again once its
  // removed photos' previews are freed.
  const [expired, setExpired] = useState<Undoable | null>(null);
  if (lastChange && !undoable) {
    setExpired(lastChange);
    setLastChange(null);
  }

  const editIds = (params.get("edit") ?? "").split(",").filter(Boolean);
  const stepParam = params.get("step");
  const step = isStep(stepParam) ? stepParam : null;
  const editing = uploading ? [] : observations.filter((o) => editIds.includes(o.id));
  const [first] = editing;
  const single = editing.length === 1;

  const open = (ids: string[], options?: { step?: EditStep; replace?: boolean }) =>
    setParams(
      { edit: ids.join(","), ...(options?.step ? { step: options.step } : {}) },
      { replace: options?.replace ?? false },
    );
  // Every screen above the grid was pushed onto the history, so back closes it.
  const back = () => void navigate(-1);

  // An editor to put in place of the one under the current screen, once back
  // has reached it: going back is asynchronous, so the swap waits for the
  // location to change.
  const pendingSwap = useRef<{ id: string; fromKey: string } | null>(null);
  useEffect(() => {
    const pending = pendingSwap.current;
    if (!pending || pending.fromKey === location.key) return;
    pendingSwap.current = null;
    setParams({ edit: pending.id }, { replace: true });
  }, [location.key, setParams]);

  // An address naming observations that aren't there (a reload, or one that
  // was just removed) is the grid's.
  const stale = editIds.length > 0 && editing.length === 0 && !uploading;
  useEffect(() => {
    if (stale) setParams({}, { replace: true });
  }, [stale, setParams]);

  const edit = (patch: BatchEdit) =>
    dispatch({ type: "edit", ids: editing.map((o) => o.id), patch });

  // --- Photos: split, remove, undo -------------------------------------------

  const releaseRemoved = (u: Undoable | null) => {
    if (u?.kind === "remove") u.photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
  };
  // Once undo is off the table, by leaving the screen or the page, a removed
  // photo's preview has no further use.
  const lastChangeRef = useRef(lastChange);
  useLayoutEffect(() => {
    lastChangeRef.current = lastChange;
  });
  useEffect(() => () => releaseRemoved(lastChangeRef.current), []);
  useEffect(() => releaseRemoved(expired), [expired]);

  const dismissUndo = () => {
    releaseRemoved(undoable);
    setLastChange(null);
  };

  const changePhotos = (kind: Undoable["kind"], observation: BatchObservation, ids: string[]) => {
    releaseRemoved(undoable);
    const photos = observation.photos.filter((p) => ids.includes(p.id));
    if (kind === "remove" && photos.length === observation.photos.length) {
      // Its last photo takes the observation with it, and this screen and the
      // editor under it have nothing left to show.
      setLastChange(null);
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      void navigate(-2);
    } else {
      setLastChange({
        kind,
        before: observation,
        index: observations.indexOf(observation),
        knownIds: observations.map((o) => o.id),
        photos,
        locationKey: location.key,
      });
    }
    dispatch({
      type: kind === "split" ? "splitPhotos" : "removePhotos",
      observationId: observation.id,
      photoIds: ids,
    });
  };

  const leftIds = new Set(undoable?.photos.map((p) => p.id));
  const made = undoable
    ? observations.filter(
        (o) => !undoable.knownIds.includes(o.id) && o.photos.every((p) => leftIds.has(p.id)),
      )
    : [];
  const [madeFirst] = made;
  const notice = ((): PhotoNotice | null => {
    const [photo] = undoable?.photos ?? [];
    if (!undoable || !photo) return null;
    if (undoable.kind === "remove") {
      return {
        title: `${plural(undoable.photos.length, "photo")} removed`,
        thumbnailUrl: photo.previewUrl,
      };
    }
    if (made.length !== 1 || !madeFirst) {
      return {
        title: `Split into ${made.length} new observations`,
        detail: "Each has its own date and location from its photo.",
        thumbnailUrl: photo.previewUrl,
      };
    }
    const madeAt = observations.indexOf(madeFirst) + 1;
    const position = `Now observation ${madeAt} of ${observations.length}.`;
    const missing = isReading(madeFirst) ? [] : missingFields(madeFirst);
    return {
      title: "Split into a new observation",
      detail:
        missing.length > 0
          ? `${position} ${describeMissing(missing)}: the photo doesn't carry it.`
          : `${position} It has its own date and location from the photo.`,
      thumbnailUrl: photo.previewUrl,
      onEdit: () => {
        setLastChange(null);
        // The new observation's editor takes the place of the one the photo came
        // from, so back from it is the batch.
        pendingSwap.current = { id: madeFirst.id, fromKey: location.key };
        back();
      },
    };
  })();

  // --- Screens ---------------------------------------------------------------

  const failed = observations.filter((o) => o.status === "failed");
  const nextId = single && first ? nextIncompleteId(observations, first.id) : null;
  const incompleteOthers = observations.filter(
    (o) => o !== first && !isReading(o) && missingFields(o).length > 0,
  ).length;

  const stepScreen = () => {
    if (!first) return null;
    if (step === "photos" && single) {
      return (
        <PhonePhotos
          observation={first}
          notice={notice}
          touchDrag={touchDrag}
          onBack={back}
          onAdd={() => onChoosePhotos(first)}
          onReorder={(photoId, index) =>
            dispatch({ type: "reorderPhoto", observationId: first.id, photoId, index })
          }
          onSplit={(ids) => changePhotos("split", first, ids)}
          onRemove={(ids) => changePhotos("remove", first, ids)}
          onUndo={() => {
            if (!undoable) return;
            dispatch({
              type: "restoreObservation",
              observation: undoable.before,
              index: undoable.index,
              dropIds: made.map((o) => o.id),
            });
            setLastChange(null);
          }}
          onDismissNotice={dismissUndo}
        />
      );
    }
    if (step === "taxon") {
      return (
        <PhoneTaxonStep
          observations={editing}
          onChoose={(taxon) => {
            edit({ taxon });
            back();
          }}
          onBack={back}
        />
      );
    }
    if (step === "location") {
      return (
        <PhoneLocationStep
          observations={editing}
          onApply={(patch) => {
            edit(patch);
            back();
          }}
          onBack={back}
        />
      );
    }
    if (step === "date" || step === "remarks") {
      const Fields = step === "date" ? DateFields : RemarksField;
      return (
        <PhoneStep
          title={step === "date" ? "Date and time" : "Remarks"}
          subtitle={single ? undefined : `For ${plural(editing.length, "observation")}`}
          backLabel="Done"
          onBack={back}
        >
          <Fields selected={editing} onEdit={edit} />
        </PhoneStep>
      );
    }
    return (
      <PhoneEditor
        observations={observations}
        editing={editing}
        nextIncomplete={nextId ? { id: nextId, left: incompleteOthers } : null}
        onBack={back}
        onStep={(next) => open(editIds, { step: next })}
        onGo={(id) => open([id], { replace: true })}
        onRemove={() => {
          back();
          onRemove(first);
        }}
      />
    );
  };

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
      <Dialog
        fullScreen
        open={editing.length > 0}
        onClose={back}
        transitionDuration={0}
        // The label goes on the dialog itself, not the backdrop around it.
        slotProps={{ paper: { "aria-label": single ? "Edit observation" : "Edit observations" } }}
      >
        {stepScreen()}
      </Dialog>
    </>
  );
}
