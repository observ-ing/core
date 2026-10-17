// A plain .ts file, so the stories check doesn't take it for a component.
import { createElement } from "react";
import type { Decorator } from "@storybook/react-vite";
import { Box } from "@mui/material";
import type { BatchObservation } from "../../../lib/batchUpload";
import { storyObservation, storyPhoto } from "../storyFixtures";

/** A phone-sized frame laid out like the app's page area: a column that fills the screen. */
export const phoneFrame: Decorator = (Story) =>
  createElement(
    Box,
    {
      sx: {
        width: 390,
        height: 844,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: 1,
        borderColor: "divider",
        bgcolor: "background.default",
      },
    },
    createElement(Story),
  );

/** A batch with one of everything: several photos, a name, missing fields. */
export const STORY_BATCH: BatchObservation[] = [
  storyObservation({
    photos: [storyPhoto(2), storyPhoto(0), storyPhoto(1)],
    taxon: { name: "Hippodamia convergens", match: null, kingdom: "Animalia", rank: "species" },
  }),
  storyObservation({ id: "o2", photos: [storyPhoto(3)] }),
  storyObservation({
    id: "o3",
    photos: [storyPhoto(4), storyPhoto(5)],
    taxon: { name: "Quercus robur", match: null, kingdom: "Plantae", rank: "species" },
    remarks: "Acorns on the ground under the canopy",
  }),
  storyObservation({ id: "o4", photos: [storyPhoto(6)], date: "" }),
  storyObservation({
    id: "o5",
    photos: [storyPhoto(7)],
    taxon: { name: "Eschscholzia californica", match: null, kingdom: "Plantae", rank: "species" },
    latitude: null,
    longitude: null,
  }),
  storyObservation({
    id: "o6",
    photos: [storyPhoto(8)],
    date: "",
    latitude: null,
    longitude: null,
  }),
];
