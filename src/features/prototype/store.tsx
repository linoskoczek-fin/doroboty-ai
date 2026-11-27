import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import posthog from "posthog-js";
import { initialState, transition, type Action, type Person, type State } from "./model";
import { parseState, readState, saveState, type StoragePort } from "./storage";

const posthogConfigured = Boolean(
  import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN && import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
);

function identifyPerson(person: Person) {
  posthog.identify(person.id, { name: person.name, role: person.role });
}
function browserStorage(): StoragePort | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
function useStore() {
  const [loaded] = useState(() => readState(browserStorage()));
  const [state, setState] = useState(loaded.state);
  const [issue, setIssue] = useState(loaded.issue);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(loaded.blocked);
  const latest = useRef(state);
  const identifiedPersonId = useRef<string | null>(null);
  function commit(next: State, replace = false) {
    latest.current = next;
    setState(next);
    setError("");
    if (blocked && !replace) return;
    try {
      saveState(browserStorage(), next);
      setIssue("");
      if (replace) setBlocked(false);
    } catch (e) {
      setIssue((e as Error).message);
    }
  }
  function run(action: Action) {
    try {
      const previousPerson = latest.current.people.find(
        (person) => person.id === latest.current.activePersonId,
      );
      const next = transition(latest.current, action);
      const nextPerson = next.people.find((person) => person.id === next.activePersonId);

      if (action.type === "select_person" && previousPerson?.id !== nextPerson?.id) {
        if (posthogConfigured) {
          if (previousPerson) posthog.reset();
          if (nextPerson) identifyPerson(nextPerson);
        }
        identifiedPersonId.current = nextPerson?.id ?? null;
      }

      commit(next);
      return true;
    } catch (e) {
      setError(
        e instanceof Error && e.name !== "ZodError"
          ? e.message
          : "Sprawdź poprawność i długość wprowadzonych danych.",
      );
      return false;
    }
  }
  function importState(raw: string) {
    try {
      const next = parseState(raw);
      commit(next, true);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }
  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);
  useEffect(() => {
    const person = state.people.find((item) => item.id === state.activePersonId);
    if (!person) {
      identifiedPersonId.current = null;
      return;
    }
    if (posthogConfigured && identifiedPersonId.current !== person.id) {
      identifyPerson(person);
      identifiedPersonId.current = person.id;
    }
  }, [state.activePersonId, state.people]);
  return {
    state,
    issue,
    error,
    blocked,
    original: loaded.original,
    run,
    importState,
    clearError: () => setError(""),
    reset: () => {
      if (posthogConfigured && latest.current.activePersonId) posthog.reset();
      identifiedPersonId.current = null;
      commit(initialState(), true);
    },
  };
}
type Store = ReturnType<typeof useStore>;
const Context = createContext<Store | null>(null);
export function PrototypeProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function usePrototype() {
  const store = useContext(Context);
  if (!store) throw new Error("PrototypeProvider is required");
  return store;
}
