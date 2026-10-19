import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LINKS_QK } from "../api/queries/links.queries";
import { linkMutation } from "../api/mutations/links.mutations";

function AddRedirectDialog() {
    const qc = useQueryClient();
    const dialog = useRef<HTMLDialogElement>(null);
    const [url, setUrl] = useState("");

    const create = useMutation({
        ...linkMutation.create,
        onSuccess: async () => {
            await qc.invalidateQueries({ queryKey: [LINKS_QK] });
            setUrl("");
            dialog.current?.close();
        },
    });

    function closeDialog() {
        create.reset();
        setUrl("");
        dialog.current?.close();
    }

    return (
        <>
            <button onClick={() => dialog.current?.showModal()} className="cursor-pointer bg-orange-600 p-2 text-white hover:bg-orange-700">Add redirect</button>

            <dialog ref={dialog} aria-label="Add redirect" onClose={() => create.reset()} className="m-auto w-full max-w-md border border-zinc-200 p-6 shadow-lg">
                <form
                    className="flex flex-col gap-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        create.mutate(url);
                    }}
                >
                    <label className="flex flex-col gap-1">
                        Destination URL
                        <input
                            type="url"
                            name="url"
                            value={url}
                            onChange={(event) => setUrl(event.target.value)}
                            placeholder="https://example.com"
                            required
                            maxLength={2048}
                            className="border p-2 bg-zinc-100 border-zinc-200 outline-none focus:border-zinc-400"
                        />
                    </label>

                    {create.isError ? <p role="alert" className="text-sm text-red-700">Could not create the redirect. Enter a full http:// or https:// URL.</p> : null}

                    <button type="submit" disabled={create.isPending} className="cursor-pointer bg-orange-600 p-2 text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-25">
                        Create
                    </button>{" "}
                    <button type="button" onClick={closeDialog} disabled={create.isPending} className="cursor-pointer border border-zinc-300 p-2 text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-25">
                        Cancel
                    </button>
                </form>
            </dialog>
        </>
    );
}

export default AddRedirectDialog;
