import { useLocation } from "react-router-dom";
import { useAppSelector, useAppDispatch } from "../store";
import { logout } from "../store/authSlice";
import { setThemeMode, openLoginModal, type ThemeMode } from "../store/uiSlice";

export function useNavigation() {
  const location = useLocation();
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const isAuthLoading = useAppSelector((state) => state.auth.isLoading);
  const themeMode = useAppSelector((state) => state.ui.themeMode);

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const handleLogin = () => {
    dispatch(openLoginModal());
  };

  const handleLogout = () => {
    dispatch(logout());
  };

  const cycleTheme = () => {
    const nextMode: ThemeMode =
      themeMode === "system" ? "light" : themeMode === "light" ? "dark" : "system";
    dispatch(setThemeMode(nextMode));
  };

  const getThemeTooltip = () => {
    switch (themeMode) {
      case "light":
        return "Light mode";
      case "dark":
        return "Dark mode";
      default:
        return "System theme";
    }
  };

  return {
    user,
    isAuthLoading,
    themeMode,
    isActive,
    handleLogin,
    handleLogout,
    cycleTheme,
    getThemeTooltip,
  };
}
