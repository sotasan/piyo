export type Tab = { id: number; ptyId: number | null };

export type Workspace = {
    id: number;
    tabs: Tab[];
    activeTabId: number;
};

let nextLocalId = 0;
export const newId = () => ++nextLocalId;

export const newWorkspace = (): Workspace => {
    const tab: Tab = { id: newId(), ptyId: null };
    return { id: newId(), tabs: [tab], activeTabId: tab.id };
};
