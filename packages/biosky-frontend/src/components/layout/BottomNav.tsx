import { useLocation, useNavigate } from "react-router-dom";
import { Paper, BottomNavigation, BottomNavigationAction } from "@mui/material";
import HomeIcon from "@mui/icons-material/Home";
import MapIcon from "@mui/icons-material/Map";

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const getValue = () => {
    if (location.pathname === "/map") return 1;
    return 0;
  };

  return (
    <Paper
      sx={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
      }}
      elevation={0}
    >
      <BottomNavigation
        value={getValue()}
        onChange={(_, newValue) => {
          navigate(newValue === 0 ? "/" : "/map");
        }}
        sx={{
          height: 60,
          "& .MuiBottomNavigationAction-root": {
            color: "text.disabled",
            "&.Mui-selected": { color: "primary.main" },
          },
        }}
      >
        <BottomNavigationAction label="Feed" icon={<HomeIcon />} aria-label="Navigate to feed" />
        <BottomNavigationAction label="Map" icon={<MapIcon />} aria-label="Navigate to map" />
      </BottomNavigation>
    </Paper>
  );
}
