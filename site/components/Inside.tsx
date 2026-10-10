import { FieldLog } from "./FieldLog";
import { VaultSheet } from "./Hero";
import { Stages } from "./Stages";
import { TryControls } from "./TryControls";

/// The overview of the technical layer: the vault's sheet, the pages, the simulation's controls
/// before launch, and the log of what the visitor did.
export function Inside() {
  return (
    <>
      <div className="wrap">
        <section className="inside-head" aria-label="Under the hood">
          <div>
            <div className="label">Under the hood</div>
            <h1 className="serif">The mechanism, page by page.</h1>
            <p className="lede">
              Everything the front page summarises, with the figures: where the money goes, the vault&apos;s seats, the sales and
              burns, the public steps, the record, and the documentation. For the people and agents who would rather check than
              trust.
            </p>
          </div>
          <VaultSheet />
        </section>
      </div>
      <Stages />
      <TryControls />
      <FieldLog />
    </>
  );
}
