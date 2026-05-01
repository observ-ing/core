import type { Meta, StoryObj } from "@storybook/react-vite";
import { Autocomplete, Box } from "@mui/material";
import { renderAutocompleteInput } from "./autocompleteInput";

/**
 * `renderAutocompleteInput` is a render-prop helper, not a component.
 * The stories wrap it in a complete `<Autocomplete>` so the visual
 * output reflects how it's actually used in the app.
 */
const meta = {
  title: "Common/autocompleteInput",
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Box sx={{ width: 360 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const OPTIONS = ["Quercus robur", "Quercus alba", "Quercus rubra"];

export const Idle: Story = {
  render: () => (
    <Autocomplete
      options={OPTIONS}
      renderInput={(params) =>
        renderAutocompleteInput({
          params,
          loading: false,
          label: "Scientific name",
          placeholder: "Search…",
        })
      }
    />
  ),
};

export const Loading: Story = {
  render: () => (
    <Autocomplete
      options={OPTIONS}
      renderInput={(params) =>
        renderAutocompleteInput({
          params,
          loading: true,
          label: "Scientific name",
          placeholder: "Search…",
        })
      }
    />
  ),
};
