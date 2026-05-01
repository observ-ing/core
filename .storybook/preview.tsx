import type { Preview } from "@storybook/react-vite";
import { withThemeFromJSXProvider } from "@storybook/addon-themes";
import { ThemeProvider, CssBaseline } from "@mui/material";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { initialize, mswLoader } from "msw-storybook-addon";
import { darkTheme, lightTheme } from "../frontend/src/theme";
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
      const initialEntries = context.parameters.routerInitialEntries ?? ["/"];
      return (
        <Provider store={store}>
          <MemoryRouter initialEntries={initialEntries}>
            <Story />
          </MemoryRouter>
        </Provider>
      );
    },
  ],
};

export default preview;
