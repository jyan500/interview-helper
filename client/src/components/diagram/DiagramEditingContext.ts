/**
 * Inline renaming on the canvas. DiagramPanel owns which node is being renamed (a double-click starts
 * it) and how a rename is applied; each DiagramNode reads this to swap its label for an input. A context
 * rather than node data, because node data is the diagram itself and goes into DiagramDoc.
 */
import { createContext } from "react";

export type DiagramEditing = {
    editingId: string | null;
    commitRename: (id: string, label: string) => void;
    cancelRename: () => void;
};

export const DiagramEditingContext = createContext<DiagramEditing>({
    editingId: null,
    commitRename: () => {},
    cancelRename: () => {},
});
