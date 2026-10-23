import { useEffect, useMemo, useRef, useState } from "react";
import { onIdTokenChanged, signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import type { ReactNode } from "react";
import LogOut from "lucide-react/dist/esm/icons/log-out";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import AlertCircle from "lucide-react/dist/esm/icons/alert-circle";
import { cloudClient, cloudConfigurationError, founderUid } from "./firebaseClient";
import { AppHeader, initialForm } from "./App";
import { AcquisitionWorkspace } from "./AcquisitionWorkspace";
import { useCloudAcquisitionRecovery } from "./useCloudAcquisitionRecovery";
import { isFounderAccount } from "./cloudPersistence";
import { signInErrorMessage } from "./signInErrorMessage";
import { returnToHomepage } from "./websiteNavigation";
import { WorkspaceSession, workspaceAdmitted } from "./workspaceSession";

export default function CloudApp() {
  const configurationError = cloudConfigurationError();
  return configurationError ? <main className="app-shell intake-shell"><AppHeader activeView="Scan" /><section className="cloud-access"><p role="status">{configurationError}</p></section></main> : <CloudAccess />;
}
function CloudAccess() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [session, setSession] = useState(0);
  const [workspace, setWorkspace] = useState<WorkspaceSession | null>(null);
  const currentWorkspace = useRef<WorkspaceSession | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    const auth = cloudClient().auth;
    let version = 0, disposed = false;
    const clear = () => { currentWorkspace.current?.close(); currentWorkspace.current = null; setWorkspace(null); };
    const unsubscribe = onIdTokenChanged(auth, current => {
      const turn = ++version;
      const same = currentWorkspace.current?.active && currentWorkspace.current.uid === current?.uid;
      if (!same) { clear(); setLoading(true); }
      setUser(current); setError("");
      const accept = (admitted: boolean) => {
        if (disposed || turn !== version || auth.currentUser !== current) return;
        if (current && admitted) {
          if (!same) {
            const next = new WorkspaceSession(current.uid, isFounderAccount(current.uid, founderUid), () => auth.currentUser === current);
            currentWorkspace.current = next; setWorkspace(next);
          }
        } else clear();
        setLoading(false);
      };
      if (!current || isFounderAccount(current.uid, founderUid)) accept(Boolean(current));
      else void workspaceAdmitted(current, founderUid).then(accept).catch(() => {
        if (!disposed && turn === version) { clear(); setLoading(false); setError("Unable to verify workspace access. Please try again."); }
      });
    }, failure => {
      ++version; clear(); setUser(null);
      setError(signInErrorMessage(failure) || "Unable to sign in. Please try again."); setLoading(false);
    });
    return () => { disposed = true; ++version; unsubscribe(); currentWorkspace.current?.close(); currentWorkspace.current = null; };
  }, []);
  useEffect(() => {
    if (!loading && !user && !signingOut) returnToHomepage();
  }, [loading, user, signingOut]);
  const authorized = Boolean(workspace?.active);
  const accountAction = user ? <>
    <button type="button" className="ghost-button cloud-header-action" onClick={async () => {
      if (!window.confirm("Sign out and clear this session's acquisition view? Unsaved edits may be lost. Save Changes to the acquisition or export your work first.")) return;
      currentWorkspace.current?.close(); currentWorkspace.current = null; setWorkspace(null); setSigningOut(true); setError("");
      const auth = cloudClient().auth;
      try {
        await signOut(auth);
        // A completed old sign-out must not clear a different account selected while it was pending.
        if (auth.currentUser && auth.currentUser !== user) { setSigningOut(false); return; }
        setUser(null); setSigningOut(false);
      } catch {
        if (auth.currentUser && auth.currentUser !== user) setSigningOut(false);
        else setError("Sign-out failed. Please try again.");
      }
    }}><LogOut aria-hidden="true" />Sign out</button>
    {error ? <span className="cloud-header-error" role="alert">{error}</span> : null}
  </> : null;
  const reload = () => {
    if (window.confirm("Reload the latest cloud workspace and discard in-memory edits? Export any unsaved work first.")) setSession(value => value + 1);
  };
  if (signingOut) return <main className="app-shell intake-shell"><AppHeader activeView="Scan" actions={accountAction} /><section className="cloud-access"><p role="status">Your workspace is closed. Completing sign-out...</p></section></main>;
  if (loading) return <main className="app-shell intake-shell"><AppHeader activeView="Scan" /><section className="cloud-access" aria-label="Cloud account" aria-busy="true"><p role="status">Checking sign-in...</p></section></main>;
  if (authorized && user && workspace) return <CloudWorkspace key={session + ":" + user.uid + ":" + workspace.epoch} workspace={workspace} accountAction={accountAction} onReload={reload} />;
  if (!user) return <main className="app-shell intake-shell"><AppHeader activeView="Scan" />
    <section className="cloud-access" aria-label="Cloud account">
      <p role="status">Returning to KingdomHaus Intelligence. Sign in from the homepage to open your workspace.</p>
      <a href="/">KingdomHaus Home</a>
    </section>
  </main>;
  return <main className="app-shell intake-shell"><AppHeader activeView="Scan" actions={accountAction} />
    <section className="cloud-access" aria-label="Cloud account">
      <p className="cloud-auth-error" role="alert"><AlertCircle aria-hidden="true" /><span>{error || "This account doesn't have access to Deal Scanner."}</span></p>
    </section>
  </main>;
}
function CloudWorkspace({ accountAction, onReload, workspace }: { accountAction: ReactNode; onReload: () => void; workspace: WorkspaceSession }) {
  const repository = useMemo(() => cloudClient().repository(workspace), [workspace]);
  const recovery = useCloudAcquisitionRecovery(repository, initialForm, workspace);
  const actions = <>
    {recovery.cloud?.status === "Error" ? <button type="button" className="cloud-header-action" onClick={onReload}><RefreshCw aria-hidden="true" />Reload cloud workspace</button> : null}
    {accountAction}
  </>;
  if (!recovery.cloud?.ready) return <main className="app-shell intake-shell"><AppHeader activeView="Scan" actions={actions} /><section className="cloud-access portfolio-loading" aria-label="Cloud recovery" aria-busy={recovery.cloud?.status === "Saving"}>
    <p className="eyebrow">Acquisition Portfolio</p>
    <h2>{recovery.storageError ? "Your portfolio could not be loaded" : "Opening your portfolio"}</h2>
    <p role="status">{recovery.storageError || "Loading cloud acquisitions and workspace..."}</p>
    <button type="button" onClick={recovery.cloud?.retry}>Retry cloud recovery</button>
  </section></main>;
  return <AcquisitionWorkspace recovery={recovery} headerActions={actions} />;
}
