// The batch uploader on a phone (#887): the same batch state as the desktop
// page, worked through full-screen steps in place of a grid with a side panel.
// Which observation is open, and which of its fields, lives in the URL's query
// so the phone's back button steps out of a screen rather than off the page.
import { useEffect, useState, type Dispatch } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Dialog } from "@mui/material";
import {
  isReading,
  missingFields,
  nextIncompleteId,
  type BatchAction,
  type BatchEdit,
  type BatchObservation,
} from "../../../lib/batchUpload";
import { plural } from "../../../lib/utils";
import { DateFields, RemarksField } from "../BatchEditor";
import { PhoneEditor, type EditStep } from "./PhoneEditor";
import { PhoneGrid } from "./PhoneGrid";
import { PhoneLocationStep } from "./PhoneLocationStep";
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
  profilePath,
  dispatch,
  onChoosePhotos,
  onUpload,
  onCancelUpload,
  onRemove,
  onRemoveSelected,
}: PhoneBatchProps) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

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

  // An address naming observations that aren't there (a reload, or one that
  // was just removed) is the grid's.
  const stale = editIds.length > 0 && editing.length === 0 && !uploading;
  useEffect(() => {
    if (stale) setParams({}, { replace: true });
  }, [stale, setParams]);

  const edit = (patch: BatchEdit) =>
    dispatch({ type: "edit", ids: editing.map((o) => o.id), patch });

  // --- Screens ---------------------------------------------------------------

  const failed = observations.filter((o) => o.status === "failed");
  const nextId = single && first ? nextIncompleteId(observations, first.id) : null;
  const incompleteOthers = observations.filter(
    (o) => o !== first && !isReading(o) && missingFields(o).length > 0,
  ).length;

  const stepScreen = () => {
    if (!first) return null;
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
