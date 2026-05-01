import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { WikiCommonsGallery } from "./WikiCommonsGallery";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

const COMMONS_CATEGORY_RESPONSE = {
  query: {
    categorymembers: [
      { title: "File:Quercus_robur_1.jpg" },
      { title: "File:Quercus_robur_2.jpg" },
      { title: "File:Quercus_robur_3.jpg" },
    ],
  },
};

const COMMONS_IMAGEINFO_RESPONSE = {
  query: {
    pages: {
      "1": {
        imageinfo: [
          {
            thumburl:
              "https://commons.wikimedia.org/wiki/Special:FilePath/Quercus_robur.jpg?width=400",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Quercus_robur_1.jpg",
            extmetadata: {
              Artist: { value: "Photographer A" },
              LicenseShortName: { value: "CC BY-SA 4.0" },
            },
          },
        ],
      },
      "2": {
        imageinfo: [
          {
            thumburl:
              "https://commons.wikimedia.org/wiki/Special:FilePath/Quercus_robur.jpg?width=400",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Quercus_robur_2.jpg",
            extmetadata: {
              Artist: { value: "Photographer B" },
              LicenseShortName: { value: "CC BY 4.0" },
            },
          },
        ],
      },
    },
  },
};

const meta = {
  title: "Common/WikiCommonsGallery",
  component: WikiCommonsGallery,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    taxonName: "Quercus robur",
    limit: 6,
  },
} satisfies Meta<typeof WikiCommonsGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

const commonsHandlers = [
  http.get(COMMONS_API, ({ request }) => {
    const url = new URL(request.url);
    const list = url.searchParams.get("list");
    if (list === "categorymembers") {
      return HttpResponse.json(COMMONS_CATEGORY_RESPONSE);
    }
    return HttpResponse.json(COMMONS_IMAGEINFO_RESPONSE);
  }),
];

export const WithImages: Story = {
  parameters: {
    msw: { handlers: commonsHandlers },
  },
};

export const Empty: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(COMMONS_API, () => HttpResponse.json({ query: { categorymembers: [] } })),
      ],
    },
  },
};
