import { useState, useEffect, FormEvent, useCallback } from "react";
import { useAppDispatch, useAppSelector } from "../../store";
import { closeUploadModal, addToast } from "../../store/uiSlice";
import { resetFeed, loadInitialFeed } from "../../store/feedSlice";
import { submitOccurrence, searchTaxa } from "../../services/api";
import type { TaxaResult } from "../../services/types";
import { ModalOverlay } from "./ModalOverlay";
import styles from "./UploadModal.module.css";

const QUICK_SPECIES = [
  { name: "Eschscholzia californica", label: "California Poppy" },
  { name: "Quercus agrifolia", label: "Coast Live Oak" },
  { name: "Columba livia", label: "Rock Dove" },
  { name: "Sciurus griseus", label: "Western Gray Squirrel" },
];

export function UploadModal() {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((state) => state.ui.uploadModalOpen);
  const user = useAppSelector((state) => state.auth.user);
  const currentLocation = useAppSelector((state) => state.ui.currentLocation);

  const [species, setSpecies] = useState("");
  const [notes, setNotes] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [suggestions, setSuggestions] = useState<TaxaResult[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (currentLocation) {
        setLat(currentLocation.lat.toFixed(6));
        setLng(currentLocation.lng.toFixed(6));
      } else {
        navigator.geolocation?.getCurrentPosition(
          (position) => {
            setLat(position.coords.latitude.toFixed(6));
            setLng(position.coords.longitude.toFixed(6));
          },
          () => {
            setLat("37.7749");
            setLng("-122.4194");
          }
        );
      }
    }
  }, [isOpen, currentLocation]);

  const handleClose = () => {
    dispatch(closeUploadModal());
    setSpecies("");
    setNotes("");
    setSuggestions([]);
  };

  const handleSpeciesChange = useCallback(async (value: string) => {
    setSpecies(value);
    if (value.length >= 2) {
      const results = await searchTaxa(value);
      setSuggestions(results.slice(0, 5));
    } else {
      setSuggestions([]);
    }
  }, []);

  const handleSuggestionClick = (name: string) => {
    setSpecies(name);
    setSuggestions([]);
  };

  const handleQuickSpecies = (name: string) => {
    setSpecies(name);
    setSuggestions([]);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!lat || !lng) {
      dispatch(addToast({ message: "Please provide a location", type: "error" }));
      return;
    }

    setIsSubmitting(true);

    try {
      await submitOccurrence({
        scientificName: species || "Unknown species",
        latitude: parseFloat(lat),
        longitude: parseFloat(lng),
        notes: notes || undefined,
        eventDate: new Date().toISOString(),
      });

      dispatch(addToast({ message: "Occurrence submitted successfully!", type: "success" }));
      handleClose();
      dispatch(resetFeed());
      dispatch(loadInitialFeed());
    } catch (error) {
      dispatch(
        addToast({
          message: `Failed to submit: ${error instanceof Error ? error.message : "Unknown error"}`,
          type: "error",
        })
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const locationDisplay = lat && lng ? `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}` : "Getting location...";

  return (
    <ModalOverlay isOpen={isOpen} onClose={handleClose}>
      <div className={user ? styles.authBanner : styles.demoBanner}>
        {user
          ? `Posting as ${user.handle ? `@${user.handle}` : user.did}`
          : "Demo Mode - Login to post to AT Protocol"}
      </div>
      <h2>New Occurrence</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="species-input">Species</label>
          <input
            type="text"
            id="species-input"
            value={species}
            onChange={(e) => handleSpeciesChange(e.target.value)}
            placeholder="e.g. Eschscholzia californica"
            autoComplete="off"
          />
          <div className={styles.quickSpecies}>
            {QUICK_SPECIES.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => handleQuickSpecies(s.name)}
              >
                {s.label}
              </button>
            ))}
          </div>
          {suggestions.length > 0 && (
            <div className={styles.suggestions}>
              {suggestions.map((s) => (
                <div
                  key={s.scientificName}
                  className={styles.suggestion}
                  onClick={() => handleSuggestionClick(s.scientificName)}
                >
                  {s.photoUrl && (
                    <img
                      src={s.photoUrl}
                      alt=""
                      className={styles.suggestionPhoto}
                    />
                  )}
                  <div className={styles.suggestionText}>
                    <strong>{s.scientificName}</strong>
                    {s.commonName && <span>{s.commonName}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="form-group">
          <label htmlFor="notes-input">Notes (optional)</label>
          <textarea
            id="notes-input"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Describe what you observed..."
          />
        </div>
        <div className="form-group">
          <label>Location (from map center)</label>
          <input type="text" value={locationDisplay} readOnly />
        </div>
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Submitting..." : "Submit"}
          </button>
        </div>
      </form>
    </ModalOverlay>
  );
}
