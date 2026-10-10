import type { Preview } from "@storybook/react-vite";
import { withThemeFromJSXProvider } from "@storybook/addon-themes";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { initialize, mswLoader } from "msw-storybook-addon";
import { darkTheme, lightTheme } from "../src/theme";
import { makeMockStore } from "./mockStore";
import { defaultHandlers } from "./handlers";

initialize({
  onUnhandledRequest: "bypass",
});

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: "todo",
    },
    msw: {
      handlers: defaultHandlers,
    },
  },
  loaders: [mswLoader],
  decorators: [
    withThemeFromJSXProvider({
      themes: {
        light: lightTheme,
        dark: darkTheme,
      },
      defaultTheme: "dark",
      Provider: ThemeProvider,
      GlobalStyles: CssBaseline,
    }),
    (Story, context) => {
      const store = makeMockStore(context.parameters.storeOptions);
      // Fresh client per render so components using query hooks (likes,
      // comments, identifications) have a QueryClient and don't bleed cache
      // between stories.
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      const initialEntries = context.parameters.routerInitialEntries ?? ["/"];
      // A data router, like the app's, so components using `useBlocker` render.
      const router = createMemoryRouter([{ path: "*", element: <Story /> }], { initialEntries });
      return (
        <Provider store={store}>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </Provider>
      );
    },
  ],
};

export default preview;
