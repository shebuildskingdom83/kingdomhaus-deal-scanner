import { useEffect, useRef } from "react";
import { WorkspaceChangedError, type WorkspaceSession } from "./workspaceSession";

export function useWorkspaceOperation(session?: WorkspaceSession, generation?: unknown) {
  const epoch = useRef(generation);
  epoch.current = generation;
  const lifecycle = useRef({ live: true, controller: new AbortController() });
  useEffect(() => {
    const cell = { live: true, controller: new AbortController() };
    lifecycle.current = cell;
    const stop = () => { cell.live = false; cell.controller.abort(); };
    session?.signal.addEventListener("abort", stop, { once: true });
    return () => { stop(); session?.signal.removeEventListener("abort", stop); };
  }, [session, generation]);
  return () => {
    const cell = lifecycle.current, started = generation;
    const assert = () => {
      session?.assert();
      if (!cell.live || cell.controller.signal.aborted || epoch.current !== started) throw new WorkspaceChangedError();
    };
    assert();
    return { assert, signal: session ? AbortSignal.any([session.signal, cell.controller.signal]) : cell.controller.signal };
  };
}
