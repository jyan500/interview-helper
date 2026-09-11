/**
 * A reusable, page-numbered pager. Presentation only — it knows the current page and the total, and
 * reports a requested page back through `onPageChange`; WHERE the page number lives (URL, state) is
 * the caller's business. Renders nothing for a single page (or none), so a caller can drop it in
 * unconditionally.
 *
 * It shows the first and last page always, a one-wide window around the current page, and an ellipsis
 * for any gap — so the control stays short whether there are 3 pages or 300.
 */

// The pages to render, with "…" marking a collapsed gap. Pure: first + last + {page-1, page, page+1},
// de-duped, in range, ascending, with an ellipsis wherever consecutive shown pages skip a number.
// e.g. page 7 of 20 -> [1, "…", 6, 7, 8, "…", 20]; page 2 of 20 -> [1, 2, 3, "…", 20].
function pageWindow(page: number, totalPages: number): (number | "…")[] {
    const shown = [...new Set([1, page - 1, page, page + 1, totalPages])]
        .filter((p) => p >= 1 && p <= totalPages)
        .sort((a, b) => a - b);
    const out: (number | "…")[] = [];
    let prev = 0;
    for (const p of shown) {
        // a gap since the last kept page collapses to one ellipsis; `prev &&` skips a leading one.
        if (prev && p - prev > 1) out.push("…");
        out.push(p);
        prev = p;
    }
    return out;
}

export default function Pagination({
    page,
    totalPages,
    onPageChange,
}: {
    page: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}) {
    if (totalPages <= 1) return null;

    return (
        <nav className="mt-[18px] flex items-center justify-center gap-2" aria-label="Pagination">
            <button
                type="button"
                className="btn btn-ghost text-[13px]"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
            >
                Previous
            </button>

            {pageWindow(page, totalPages).map((item, i) =>
                item === "…" ? (
                    <span key={`gap-${i}`} className="px-1 text-[13px] text-neutral-400">
                        …
                    </span>
                ) : (
                    <button
                        key={item}
                        type="button"
                        className={"btn text-[13px] " + (item === page ? "btn-primary" : "btn-secondary")}
                        aria-current={item === page ? "page" : undefined}
                        onClick={() => onPageChange(item)}
                    >
                        {item}
                    </button>
                ),
            )}

            <button
                type="button"
                className="btn btn-ghost text-[13px]"
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
            >
                Next
            </button>
        </nav>
    );
}
