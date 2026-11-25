import { useState } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import ImagePicker from "./ImagePicker.jsx";

function setupUser() {
  return userEvent.setup({ delay: null });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function Harness({ error, onBlur, onUpload, uploadFileLabel }) {
  const [value, setValue] = useState("/images/projects/old.webp");

  return (
    <ImagePicker
      id="image-path"
      label="Image path"
      value={value}
      onChange={setValue}
      onBlur={onBlur}
      onUpload={onUpload}
      error={error}
      uploadFileLabel={uploadFileLabel}
    />
  );
}

it("uses the supplied upload label and omits the file input without an upload handler", () => {
  const { rerender } = render(<Harness />);

  expect(screen.getByLabelText(/Image path/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Upload image file")).not.toBeInTheDocument();

  rerender(<Harness onUpload={vi.fn()} uploadFileLabel="Upload cover image" />);
  expect(screen.getByLabelText("Upload cover image")).toBeInTheDocument();
});

it("disables the file input during upload and clears the upload error on typing", async () => {
  const user = setupUser();
  const pending = deferred();
  render(<Harness onUpload={vi.fn(() => pending.promise)} />);

  const fileInput = screen.getByLabelText("Upload image file");
  await user.upload(
    fileInput,
    new File(["image"], "large.png", { type: "image/png" }),
  );

  expect(fileInput).toBeDisabled();
  expect(screen.getByText("Uploading…")).toBeInTheDocument();

  await act(async () => {
    pending.reject(new Error("Too large."));
    await pending.promise.catch(() => {});
  });

  expect(await screen.findByText("Too large.")).toBeInTheDocument();
  expect(fileInput).not.toBeDisabled();

  const path = screen.getByLabelText(/Image path/);
  await user.clear(path);
  await user.paste("/images/projects/new.webp");

  expect(screen.queryByText("Too large.")).not.toBeInTheDocument();
});

it("shows an upload failure alongside an existing field error", async () => {
  const user = setupUser();
  render(
    <Harness
      error="Server rejected this image."
      onUpload={vi.fn().mockRejectedValue(new Error("Only WebP images are supported."))}
    />,
  );

  await user.upload(
    screen.getByLabelText("Upload image file"),
    new File(["image"], "large.png", { type: "image/png" }),
  );

  expect(
    await screen.findByText(
      "Server rejected this image. Only WebP images are supported.",
    ),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("alert")).toHaveLength(1);

  const fileInput = screen.getByLabelText("Upload image file");
  const pathInput = screen.getByLabelText(/Image path/);
  expect(fileInput).toHaveAttribute("aria-invalid", "true");
  expect(pathInput).toHaveAttribute(
    "aria-describedby",
    fileInput.getAttribute("aria-describedby"),
  );
});

it("clears a retry's upload error while preserving the field error", async () => {
  const user = setupUser();
  const onUpload = vi
    .fn()
    .mockRejectedValueOnce(new Error("Upload failed."))
    .mockResolvedValueOnce(undefined);
  render(<Harness error="Server rejected this image." onUpload={onUpload} />);

  const fileInput = screen.getByLabelText("Upload image file");
  const file = new File(["image"], "retry.png", { type: "image/png" });

  await user.upload(fileInput, file);
  expect(await screen.findByText(/Upload failed\./)).toBeInTheDocument();
  expect(screen.getByText(/Server rejected this image\./)).toBeInTheDocument();

  await user.upload(fileInput, file);

  await waitFor(() => {
    expect(screen.queryByText(/Upload failed\./)).not.toBeInTheDocument();
  });
  expect(screen.getByText("Server rejected this image.")).toBeInTheDocument();
  expect(fileInput).not.toHaveAttribute("aria-invalid");
  expect(onUpload).toHaveBeenCalledTimes(2);
});

it("can upload the same file twice", async () => {
  const user = setupUser();
  const onUpload = vi.fn(async () => {});
  render(<Harness onUpload={onUpload} />);

  const fileInput = screen.getByLabelText("Upload image file");
  const file = new File(["image"], "same.webp", { type: "image/webp" });

  await user.upload(fileInput, file);
  await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));

  await user.upload(fileInput, file);
  await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
});

it("validates a manual URL after blur and restores hint linkage once corrected", async () => {
  const user = setupUser();
  const onBlur = vi.fn();
  render(<Harness onBlur={onBlur} />);

  const path = screen.getByLabelText(/Image path/);
  await user.clear(path);
  await user.paste("not-an-image");

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(path).not.toHaveAttribute("aria-invalid");

  await user.tab();

  expect(onBlur).toHaveBeenCalledWith("not-an-image");
  expect(path).toHaveAttribute("aria-invalid", "true");
  const errorId = path.getAttribute("aria-describedby");
  expect(document.getElementById(errorId)).toHaveAttribute("role", "alert");

  await user.clear(path);
  await user.paste("/images/projects/new.webp");

  expect(path).not.toHaveAttribute("aria-invalid");
  const hintId = path.getAttribute("aria-describedby");
  expect(document.getElementById(hintId)).toHaveTextContent(/Upload an image/);
});
