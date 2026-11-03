import { createContext, useContext } from "react";
import type { State, AssetMeta } from "../domain/model";
export interface AppContext {
  state: State;
  assets: AssetMeta[];
  busy: boolean;
  act: (fn: () => Promise<unknown>, message?: string) => Promise<boolean>;
  confirm: (
    title: string,
    description: string,
    action: () => Promise<unknown>,
  ) => void;
}
export const Context = createContext<AppContext>(null!);
export const useApp = () => useContext(Context);
