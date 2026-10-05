"use client";

import { createContext, useContext, type ReactNode } from "react";

const PrelaunchHomeContext = createContext(false);

export function PrelaunchHomeProvider({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return <PrelaunchHomeContext.Provider value={active}>{children}</PrelaunchHomeContext.Provider>;
}

export function usePrelaunchHome() {
  return useContext(PrelaunchHomeContext);
}
