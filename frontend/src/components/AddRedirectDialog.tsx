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
            <button onClick={() => dialog.current?.showModal()}>Add redirect</button>

            <dialog ref={dialog} aria-label="Add redirect" onClose={() => create.reset()} className="m-auto w-full max-w-md p-4">
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        create.mutate(url);
                    }}
                >
                    <label>
                        Destination URL
                        <input
                            type="url"
                            name="url"
                            value={url}
                            onChange={(event) => setUrl(event.target.value)}
                            placeholder="https://example.com"
                            required
                            maxLength={2048}
                        />
                    </label>

                    {create.isError ? <p role="alert">Could not create the redirect. Enter a full http:// or https:// URL.</p> : null}

                    <button type="submit" disabled={create.isPending}>
                        Create
                    </button>{" "}
                    <button type="button" onClick={closeDialog} disabled={create.isPending}>
                        Cancel
                    </button>
                </form>
            </dialog>
        </>
    );
}

export default AddRedirectDialog;
