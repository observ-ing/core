import { useAppDispatch, useAppSelector } from "../../store";
import { logout } from "../../store/authSlice";
import { openLoginModal } from "../../store/uiSlice";
import styles from "./Header.module.css";

export function Header() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);

  const handleLogout = () => {
    dispatch(logout());
  };

  const handleLogin = () => {
    dispatch(openLoginModal());
  };

  return (
    <header className={styles.header}>
      <div className={styles.logo}>BioSky</div>
      <div className={styles.userMenu}>
        {user ? (
          <>
            <span className={styles.userHandle}>
              {user.handle ? `@${user.handle}` : user.did}
            </span>
            <button className="btn btn-secondary" onClick={handleLogout}>
              Log out
            </button>
          </>
        ) : (
          <button className="btn btn-secondary" onClick={handleLogin}>
            Log in
          </button>
        )}
      </div>
    </header>
  );
}
