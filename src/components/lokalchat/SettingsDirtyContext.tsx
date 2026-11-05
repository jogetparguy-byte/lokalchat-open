import {
  createContext,
  useContext,
  useEffect,
  useId,
  type ReactNode,
} from "react";

const DirtyContext = createContext<(id: string, dirty: boolean) => void>(
  () => {},
);
export const SettingsDirtyProvider = ({
  children,
  onChange,
}: {
  children: ReactNode;
  onChange: (id: string, dirty: boolean) => void;
}) => (
  <DirtyContext.Provider value={onChange}>{children}</DirtyContext.Provider>
);

export function useSettingsDirty(dirty: boolean) {
  const id = useId();
  const report = useContext(DirtyContext);
  useEffect(() => {
    report(id, dirty);
    return () => report(id, false);
  }, [id, dirty, report]);
}
