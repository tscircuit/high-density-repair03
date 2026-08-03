import samples from "dataset-drc14"
import {
  createDrc14ProblemsFixtureSample,
  type Drc14DatasetSample,
  DrcProblemsFixture,
  type DrcProblemsFixtureSampleSource,
} from "../fixture-support/DrcProblemsFixture"

const sampleSources = (samples as Drc14DatasetSample[]).map(
  (sample, sampleIndex): DrcProblemsFixtureSampleSource => {
    const id = sample.id ?? `sample${String(sampleIndex + 1).padStart(3, "0")}`
    return {
      id,
      load: () => createDrc14ProblemsFixtureSample(sample, sampleIndex),
    }
  },
)

export default function Drc14ProblemsFixture() {
  return (
    <DrcProblemsFixture
      datasetLabel="DRC14"
      fixtureId="drc14"
      sampleSources={sampleSources}
    />
  )
}
