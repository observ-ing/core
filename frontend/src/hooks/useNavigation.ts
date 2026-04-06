import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAppSelector, useAppDispatch } from "../store";
import { logout } from "../store/authSlice";
import { setThemeMode, type ThemeMode } from "../store/uiSlice";
import { fetchUnreadCount } from "../services/api";

export function useNavigation() {
  const location = useLocation();
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const isAuthLoading = useAppSelector((state) => state.auth.isLoading);
  const themeMode = useAppSelector((state) => state.ui.themeMode);
  
  const [unreadCount, setUnreadCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    const poll = () => {
      fetchUnreadCount()
        .then((data) => setUnreadCount(data.count))
        .catch(() => {});
    };
    poll();
    intervalRef.current = setInterval(poll, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [user]);

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
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
      case "light": return "Light mode";
      case "dark": return "Dark mode";
      default: return "System theme";
    }
  };

  return {
    user,
    isAuthLoading,
    themeMode,
    unreadCount,
    isActive,
    handleLogout,
    cycleTheme,
    getThemeTooltip,
    dispatch,
  };
}
