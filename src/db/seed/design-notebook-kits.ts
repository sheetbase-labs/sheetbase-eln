/**
 * What each demo project's experiments are about, in the lab's own words.
 * Experiments named in the design get their topic from `NAMED_TOPICS`; the
 * numbered runs behind each project draw their titles and objectives from the
 * project's kit in order, repeating with a "repeat" suffix once the list runs
 * out.
 */
import type { Kit, Readout, Topic } from './design-notebook-content'

const titre = (base = 6.8): Readout => ({
  name: 'Genome titre',
  unit: '× 10¹¹ vg/mL',
  base,
  spread: 0.22,
  digits: 1,
})
const viability = (base = 93): Readout => ({
  name: 'Viability',
  unit: '%',
  base,
  spread: 0.04,
  digits: 1,
})
const yieldPct = (base = 86): Readout => ({
  name: 'Step yield',
  unit: '%',
  base,
  spread: 0.07,
  digits: 1,
})

export const KITS: Record<string, Kit> = {
  aav9: {
    factor: 'Condition',
    conditions: ['2 L bench', '10 L pilot', '50 L engineering', '2 L repeat'],
    readouts: [titre(), yieldPct(), viability(91)],
    method:
      'HEK293 suspension cells were transfected with the three-plasmid AAV9 system at 1.0 µg DNA per mL and harvested at 72 h. Genome titre by ddPCR (method EM-007), step yield from load and pool volumes.',
    quirks: [
      'No sign of capsid aggregation at harvest.',
      'One bag showed a slow pH drift after 48 h and is flagged in the batch record.',
      'Cell counts at harvest were within 5 % across vessels.',
    ],
    next: [
      'Take this setting into the 50 L confirmation run.',
      'Carry the same load into the next transfer lot.',
    ],
    prep: [
      'Thaw working cell bank vial and confirm viability above 95 %',
      'Check plasmid lots against the certificate of analysis',
      'Book the bioreactor and the ddPCR reader',
    ],
    holdReason: 'Waiting on the new plasmid lot before the next transfection.',
    topics: [
      {
        title: 'Feed titre check at 2 L',
        objective:
          'Confirm that the 2 L bench process reproduces the genome titre reported at the sending site before scaling up.',
      },
      {
        title: 'TFF load and flux, 2 L',
        objective:
          'Find the load per square metre of membrane that keeps flux stable through concentration and diafiltration.',
        factor: 'Load',
        conditions: ['200 L/m²', '300 L/m²', '400 L/m²', '500 L/m²'],
        readouts: [
          { name: 'Flux', unit: 'LMH', base: 38, spread: 0.12, digits: 1 },
          yieldPct(92),
        ],
      },
      {
        title: 'AEX load capacity',
        objective:
          'Establish the dynamic binding capacity of the AEX column for AAV9 full capsids at pH 9.0.',
        factor: 'Load',
        conditions: ['1 × 10¹³ vg/mL', '2 × 10¹³ vg/mL', '3 × 10¹³ vg/mL'],
        readouts: [
          yieldPct(78),
          { name: 'Full capsids', unit: '%', base: 62, spread: 0.1, digits: 0 },
        ],
      },
      {
        title: 'Hold-time check, 2–8 °C',
        objective:
          'Check that clarified harvest keeps its titre and capsid integrity over a 24 to 72 h hold at 2–8 °C.',
        factor: 'Hold time',
        conditions: ['0 h', '24 h', '48 h', '72 h'],
        readouts: [
          titre(7.1),
          {
            name: 'Aggregates',
            unit: '%',
            base: 3.2,
            spread: 0.25,
            digits: 1,
            higherIsBetter: false,
          },
        ],
      },
      {
        title: 'Genome titre on retained samples',
        objective:
          'Re-read retained samples from the first campaign on the validated ddPCR method to put old and new titres on one scale.',
        factor: 'Sample set',
        conditions: ['Campaign 1', 'Campaign 2', 'Campaign 3'],
        readouts: [
          titre(5.9),
          {
            name: 'Repeatability',
            unit: '% CV',
            base: 6,
            spread: 0.3,
            digits: 1,
            higherIsBetter: false,
          },
        ],
      },
      {
        title: 'Pilot run at 10 L',
        objective:
          'Run the transferred process at 10 L and compare titre, viability and yield with the 2 L reference.',
      },
    ],
  },
  lvvStability: {
    factor: 'Storage',
    conditions: ['2–8 °C, vial', '2–8 °C, bag', '−80 °C reference'],
    readouts: [
      {
        name: 'Infectious titre',
        unit: '× 10⁷ TU/mL',
        base: 4.4,
        spread: 0.18,
        digits: 2,
      },
      { name: 'p24', unit: 'ng/mL', base: 310, spread: 0.1, digits: 0 },
    ],
    method:
      'Aliquots of LVV harvest H-21 were held at 2–8 °C and pulled at the stated day. Infectious titre was read by flow cytometry on transduced HEK293T, p24 by ELISA.',
    quirks: [
      'The −80 °C reference gave a titre in line with the day 0 value.',
      'Vial and bag held within the assay variation of each other.',
      'One replicate well was excluded for a pipetting error and repeated.',
    ],
    next: [
      'Extend the hold to the next pull.',
      'Use this loss rate for the shelf-life estimate.',
    ],
    prep: [
      'Pull aliquots from the 2–8 °C unit and log the temperature',
      'Thaw the reference vial at room temperature',
      'Prepare HEK293T plates for the transduction assay',
    ],
    holdReason: 'Paused until the stability chamber is requalified.',
    topics: [
      {
        title: 'Day 1 stability pull, 2–8 °C',
        objective:
          'Measure infectious titre and p24 one day after harvest to set the day 1 point of the 2–8 °C hold study.',
      },
      {
        title: 'Day 2 stability pull, 2–8 °C',
        objective:
          'Measure infectious titre and p24 two days after harvest as the second point of the hold study.',
      },
      {
        title: 'Day 4 stability pull, 2–8 °C',
        objective:
          'Measure infectious titre and p24 four days after harvest and compare with day 0.',
      },
      {
        title: 'Day 5 stability pull, 2–8 °C',
        objective:
          'Measure infectious titre and p24 five days after harvest and compare with day 0.',
      },
      {
        title: 'Day 6 stability pull, 2–8 °C',
        objective:
          'Measure infectious titre and p24 six days after harvest and compare with day 0.',
      },
      {
        title: 'Day 10 stability pull, 2–8 °C',
        objective:
          'Measure infectious titre and p24 ten days after harvest to see whether loss accelerates after the first week.',
      },
      {
        title: 'Day 14 stability pull, 2–8 °C',
        objective:
          'Measure infectious titre and p24 fourteen days after harvest, the last planned point of the hold study.',
      },
      {
        title: 'Freeze–thaw after 7 days at 2–8 °C',
        objective:
          'Check how one freeze–thaw cycle after a week at 2–8 °C changes infectious titre compared with the unfrozen aliquot.',
      },
    ],
  },
  cart: {
    factor: 'Medium',
    conditions: ['Medium A', 'Medium B', 'Medium C', 'Current medium'],
    readouts: [
      { name: 'Fold expansion', unit: '×', base: 38, spread: 0.2, digits: 0 },
      { name: 'CD3+ purity', unit: '%', base: 96, spread: 0.02, digits: 1 },
    ],
    method:
      'CD3+ cells from one donor were activated on day 0 and expanded in G-Rex flasks with IL-2 at 100 IU/mL. Counts and viability on the NC-202 on days 3, 7 and 10; phenotype by flow on day 10.',
    quirks: [
      'Donor 3 expanded more slowly in every medium.',
      'CD4:CD8 ratio stayed close to the starting ratio.',
      'Exhaustion markers were low in all conditions.',
    ],
    next: [
      'Confirm with a second donor before changing the medium.',
      'Test the winning medium at the larger flask size.',
    ],
    prep: [
      'Thaw donor PBMC and confirm viability above 90 %',
      'Warm media and cytokines to room temperature',
      'Label G-Rex flasks and log the lots',
    ],
    holdReason: 'On hold while the donor material is re-qualified.',
    topics: [
      {
        title: 'Medium A vs B, donor 1',
        objective:
          'Compare expansion and purity of CD3+ cells in medium A and medium B over ten days from donor 1.',
      },
      {
        title: 'Medium A vs B, donor 2',
        objective:
          'Repeat the medium comparison with donor 2 to see whether the ranking holds.',
      },
      {
        title: 'IL-2 dose, 50 to 300 IU/mL',
        objective:
          'Find the IL-2 dose that gives the best expansion without driving exhaustion.',
        factor: 'IL-2',
        conditions: ['50 IU/mL', '100 IU/mL', '200 IU/mL', '300 IU/mL'],
      },
      {
        title: 'Seeding density at activation',
        objective:
          'Compare activation at 0.5, 1.0 and 1.5 × 10⁶ cells/mL for expansion and viability.',
        factor: 'Density',
        conditions: ['0.5 × 10⁶/mL', '1.0 × 10⁶/mL', '1.5 × 10⁶/mL'],
      },
      {
        title: 'Feed schedule, day 3 vs day 4',
        objective:
          'Compare the first medium top-up on day 3 and day 4 for expansion and lactate.',
        factor: 'First feed',
        conditions: ['Day 3', 'Day 4', 'Day 3 and 5'],
      },
      {
        title: 'Serum-free vs serum-containing',
        objective:
          'Check that the serum-free medium matches the serum-containing one on expansion and phenotype.',
        factor: 'Medium',
        conditions: [
          'Serum-free',
          'Serum-containing',
          'Serum-free + supplement',
        ],
      },
      {
        title: 'Flask format, G-Rex 6 vs 100',
        objective:
          'Check that expansion in the G-Rex 100 matches the 6-well format.',
        factor: 'Format',
        conditions: ['G-Rex 6', 'G-Rex 24', 'G-Rex 100'],
      },
      {
        title: 'Cryo recovery of expanded cells',
        objective:
          'Measure viability and function of expanded cells after freezing and thawing.',
        factor: 'Freeze medium',
        conditions: ['CryoStor 10', 'CryoStor 5', '10 % DMSO'],
      },
      {
        title: 'Activation reagent lot check',
        objective:
          'Qualify the new activation reagent lot against the current one.',
        factor: 'Lot',
        conditions: ['Current lot', 'New lot', 'No reagent'],
      },
      {
        title: 'Day 14 extended culture',
        objective:
          'See whether purity and viability hold when expansion runs to day 14.',
        factor: 'Harvest day',
        conditions: ['Day 10', 'Day 12', 'Day 14'],
      },
      {
        title: 'Lactate and glucose profile',
        objective:
          'Track lactate and glucose through the run to set a feed trigger.',
        factor: 'Feed trigger',
        conditions: ['Lactate 15 mM', 'Lactate 20 mM', 'Fixed day'],
      },
      {
        title: 'Donor-to-donor spread',
        objective:
          'Measure how much expansion varies between four donors in the chosen medium.',
        factor: 'Donor',
        conditions: ['Donor 1', 'Donor 2', 'Donor 3', 'Donor 4'],
      },
    ],
  },
  fullEmpty: {
    factor: 'Sample',
    conditions: [
      'Reference full',
      'Reference empty',
      '50:50 mix',
      'Process sample',
    ],
    readouts: [
      { name: 'Full capsids', unit: '%', base: 58, spread: 0.16, digits: 1 },
      {
        name: 'Repeatability',
        unit: '% CV',
        base: 3.4,
        spread: 0.3,
        digits: 1,
        higherIsBetter: false,
      },
    ],
    method:
      'Capsid populations were separated by analytical ultracentrifugation at 20 °C and 15,000 rpm with absorbance at 260 and 280 nm. Full fraction taken from the sedimentation coefficient distribution.',
    quirks: [
      'The partially filled peak between full and empty was integrated with the empty fraction.',
      'Run-to-run drift was below the acceptance limit.',
    ],
    next: [
      'Use the same integration window for the qualification report.',
      'Repeat on a second instrument to close out the precision section.',
    ],
    prep: [
      'Dilute samples to OD 0.8',
      'Run the instrument warm-up and vacuum check',
      'Load the reference standards',
    ],
    holdReason: 'Waiting for the instrument service visit.',
    topics: [
      {
        title: 'Linearity of the 50:50 mix',
        objective:
          'Show that the measured full fraction moves linearly across mixes of full and empty reference material.',
        factor: 'Mix',
        conditions: [
          '0 % full',
          '25 % full',
          '50 % full',
          '75 % full',
          '100 % full',
        ],
      },
      {
        title: 'Intermediate precision, two analysts',
        objective:
          'Show that two analysts get the same full fraction on three days.',
        factor: 'Analyst',
        conditions: [
          'Analyst 1, day 1',
          'Analyst 2, day 1',
          'Analyst 1, day 2',
          'Analyst 2, day 2',
        ],
      },
      {
        title: 'Specificity against partially filled capsids',
        objective:
          'Check that partially filled capsids do not shift the full fraction by more than the acceptance limit.',
      },
      {
        title: 'Robustness to rotor speed',
        objective:
          'Check how a ±1,000 rpm change in rotor speed moves the full fraction.',
        factor: 'Rotor speed',
        conditions: ['14,000 rpm', '15,000 rpm', '16,000 rpm'],
      },
      {
        title: 'Comparison with cryo-EM counts',
        objective:
          'Compare the AUC full fraction with counts from cryo-EM for the same three lots.',
        factor: 'Lot',
        conditions: ['Lot A', 'Lot B', 'Lot C'],
      },
    ],
  },
  ambr: {
    factor: 'Condition',
    conditions: [
      'Control feed',
      'High glucose feed',
      'Low temperature shift',
      'Extended perfusion',
    ],
    readouts: [
      {
        name: 'Peak cell density',
        unit: '× 10⁶/mL',
        base: 38,
        spread: 0.12,
        digits: 1,
      },
      titre(5.4),
      viability(92),
    ],
    method:
      'Ambr 250 vessels were seeded at 0.8 × 10⁶ cells/mL and run in perfusion from day 3 at 1 vessel volume per day. pH 7.1, DO 40 %. Titre by ddPCR on day 7 and day 10 samples.',
    quirks: [
      'Vessel 4 needed a manual pH recalibration on day 5.',
      'Lactate stayed below 20 mM in every vessel.',
      'Cell-free harvest was clear in all vessels.',
    ],
    next: [
      'Move the leading condition to the next Ambr run.',
      'Set the feed rate from this run in the scale-up plan.',
    ],
    prep: [
      'Autoclave and calibrate the vessels',
      'Prepare feed bottles and log the lots',
      'Check the offline analyser calibration',
    ],
    holdReason: 'Paused until the Ambr 250 is back from its service visit.',
    topics: [
      {
        title: 'Ambr 250 run AMB-25-104',
        objective:
          'Run the standard perfusion process in four vessels to set the baseline for the scale-down model.',
      },
      {
        title: 'Perfusion rate screen',
        objective:
          'Compare perfusion rates of 0.5, 1.0 and 1.5 vessel volumes per day.',
        factor: 'Perfusion rate',
        conditions: ['0.5 VVD', '1.0 VVD', '1.5 VVD'],
      },
      {
        title: 'Temperature shift at day 5',
        objective:
          'Test a shift from 37 to 33 °C on day 5 for titre and viability.',
        factor: 'Temperature',
        conditions: ['37 °C constant', '33 °C from day 5', '34 °C from day 4'],
      },
      {
        title: 'Antifoam dose',
        objective:
          'Find the lowest antifoam dose that holds foam down without affecting growth.',
        factor: 'Antifoam',
        conditions: ['5 ppm', '10 ppm', '20 ppm'],
      },
      {
        title: 'Seed train variability',
        objective:
          'Measure how much the starting seed train alone changes the run.',
        factor: 'Seed train',
        conditions: ['Seed train 1', 'Seed train 2', 'Seed train 3'],
      },
      {
        title: 'Alternating tangential flow cut-off',
        objective:
          'Compare 0.2 µm and 50 kDa hollow fibres for product retention.',
        factor: 'Filter',
        conditions: ['0.2 µm', '50 kDa', '0.45 µm'],
      },
      {
        title: 'Dissolved oxygen set point',
        objective: 'Compare dissolved oxygen set points of 30, 40 and 60 %.',
        factor: 'DO',
        conditions: ['30 %', '40 %', '60 %'],
      },
      {
        title: 'Media hold before use',
        objective:
          'Check that medium held for two weeks at 2–8 °C supports the same growth.',
        factor: 'Hold',
        conditions: ['Fresh', '1 week', '2 weeks'],
      },
      {
        title: 'Induction timing',
        objective: 'Compare transfection at day 3 and day 4 for titre.',
        factor: 'Transfection day',
        conditions: ['Day 3', 'Day 4', 'Day 5'],
      },
      {
        title: 'Harvest day',
        objective:
          'Compare harvest at day 8, 10 and 12 for titre and impurities.',
        factor: 'Harvest',
        conditions: ['Day 8', 'Day 10', 'Day 12'],
      },
    ],
  },
  lvvTransfection: {
    factor: 'Condition',
    conditions: ['Current ratio', 'Higher PEI', 'Lower PEI', 'Lipid reagent'],
    readouts: [
      {
        name: 'Infectious titre',
        unit: '× 10⁷ TU/mL',
        base: 3.8,
        spread: 0.2,
        digits: 2,
      },
      viability(88),
    ],
    method:
      'HEK293T cells at 1.5 × 10⁶/mL were transfected with the four-plasmid LVV system. Supernatant was collected at 48 h, filtered through 0.45 µm and titred on HEK293T by flow cytometry.',
    quirks: [
      'Cell clumping was visible at the highest PEI ratio.',
      'The no-DNA control read at background.',
    ],
    next: [
      'Hold at the best ratio until the downstream chromatography decision.',
      'Repeat at 2 L before committing.',
    ],
    prep: [
      'Expand HEK293T to the required cell number',
      'Prepare plasmid mixes and verify concentrations',
      'Pre-warm PEI and OptiMEM',
    ],
    holdReason:
      'Project on hold pending the client decision on the transfer plan.',
    topics: [
      {
        title: 'PEI:DNA ratio, first sweep',
        objective:
          'Find the PEI:DNA ratio that gives the highest infectious titre.',
        factor: 'PEI:DNA',
        conditions: ['2:1', '3:1', '4:1', '5:1'],
      },
      {
        title: 'DNA amount per cell',
        objective: 'Compare 0.5, 1.0 and 1.5 µg DNA per mL of culture.',
        factor: 'DNA',
        conditions: ['0.5 µg/mL', '1.0 µg/mL', '1.5 µg/mL'],
      },
      {
        title: 'Plasmid ratio gag-pol : rev : VSV-G',
        objective: 'Compare three helper plasmid ratios for titre and p24.',
        factor: 'Ratio',
        conditions: ['4:1:2', '3:1:2', '2:1:2'],
      },
      {
        title: 'Complexing time',
        objective:
          'Compare 5, 15 and 30 minute complexing times before adding to the cells.',
        factor: 'Complexing',
        conditions: ['5 min', '15 min', '30 min'],
      },
      {
        title: 'Cell density at transfection',
        objective: 'Compare transfection at 1.0, 1.5 and 2.0 × 10⁶ cells/mL.',
        factor: 'Density',
        conditions: ['1.0 × 10⁶/mL', '1.5 × 10⁶/mL', '2.0 × 10⁶/mL'],
      },
      {
        title: 'Sodium butyrate boost',
        objective: 'Test whether 5 mM sodium butyrate at 6 h raises the titre.',
        factor: 'Butyrate',
        conditions: ['None', '2 mM', '5 mM'],
      },
      {
        title: 'Harvest time, 36 to 60 h',
        objective:
          'Find the harvest time with the best titre before cell debris rises.',
        factor: 'Harvest',
        conditions: ['36 h', '48 h', '60 h'],
      },
      {
        title: 'Medium exchange at 6 h',
        objective:
          'Test whether exchanging the medium 6 h after transfection helps.',
        factor: 'Exchange',
        conditions: ['No exchange', 'Full exchange', 'Half exchange'],
      },
      {
        title: 'Benzonase timing',
        objective:
          'Compare benzonase added at harvest or at the start of clarification.',
        factor: 'Addition',
        conditions: ['At harvest', 'At clarification', 'None'],
      },
      {
        title: 'Filter type for clarification',
        objective: 'Compare three 0.45 µm filters for titre recovery.',
        factor: 'Filter',
        conditions: ['PES', 'PVDF', 'Cellulose acetate'],
      },
      {
        title: 'Reproducibility at 250 mL',
        objective:
          'Repeat the best conditions in three separate flasks to see the run-to-run spread.',
        factor: 'Flask',
        conditions: ['Flask 1', 'Flask 2', 'Flask 3'],
      },
    ],
  },
  hek293: {
    factor: 'Test',
    conditions: ['Vial 1', 'Vial 2', 'Vial 3'],
    readouts: [
      viability(97),
      {
        name: 'Doubling time',
        unit: 'h',
        base: 22,
        spread: 0.08,
        digits: 1,
        higherIsBetter: false,
      },
    ],
    method:
      'Vials from the working cell bank were thawed into pre-warmed medium and passaged three times. Viability by trypan blue on the NC-202 and doubling time from counts at 24 h intervals.',
    quirks: [
      'No mycoplasma signal in any vial.',
      'Morphology matched the master bank at passage 3.',
    ],
    next: [
      'File the result with the cell bank record.',
      'Release the bank for use.',
    ],
    prep: [
      'Thaw vials into pre-warmed medium',
      'Book the NC-202',
      'Send supernatant for mycoplasma PCR',
    ],
    holdReason: 'Paused until the mycoplasma result is back.',
    topics: [
      {
        title: 'Viability after thaw',
        objective:
          'Measure viability and recovery of three vials after thaw as part of the working cell bank release.',
      },
      {
        title: 'Doubling time over five passages',
        objective:
          'Measure growth over five passages to check the bank grows at the expected rate.',
      },
      {
        title: 'Mycoplasma and sterility',
        objective:
          'Confirm the bank is free of mycoplasma and shows no microbial growth.',
        factor: 'Method',
        conditions: ['PCR', 'Culture', 'Indicator cell line'],
        readouts: [
          {
            name: 'Positives',
            unit: 'of 3',
            base: 0.2,
            spread: 1,
            digits: 0,
            higherIsBetter: false,
          },
        ],
      },
      {
        title: 'Identity by STR profile',
        objective: 'Confirm the bank matches the HEK293 reference STR profile.',
        factor: 'Locus set',
        conditions: ['Set 1', 'Set 2', 'Set 3'],
        readouts: [
          { name: 'Match', unit: '%', base: 98, spread: 0.02, digits: 0 },
        ],
      },
      {
        title: 'Transfection competence',
        objective:
          'Check that the bank transfects as well as the master bank with a GFP reporter.',
        factor: 'Bank',
        conditions: ['Master bank', 'Working bank', 'Reference'],
        readouts: [
          {
            name: 'GFP positive',
            unit: '%',
            base: 84,
            spread: 0.06,
            digits: 1,
          },
          viability(92),
        ],
      },
      {
        title: 'Karyotype and morphology',
        objective: 'Record morphology and chromosome count at passage 10.',
        factor: 'Passage',
        conditions: ['P3', 'P6', 'P10'],
        readouts: [
          {
            name: 'Modal chromosome number',
            unit: '',
            base: 64,
            spread: 0.03,
            digits: 0,
          },
        ],
      },
    ],
  },
  elisa: {
    factor: 'Level',
    conditions: ['Low control', 'Mid control', 'High control'],
    readouts: [
      { name: 'Recovery', unit: '%', base: 100, spread: 0.06, digits: 1 },
      {
        name: 'Intra-plate CV',
        unit: '%',
        base: 5.2,
        spread: 0.3,
        digits: 1,
        higherIsBetter: false,
      },
    ],
    method:
      'Capsid ELISA (AAV8/9) run in the receiving lab with the sending lab’s kit lots. Three controls in triplicate on each plate, four plates per day, standard curve fitted with a four-parameter model.',
    quirks: [
      'Plate 4 edge wells read high and were excluded per the method.',
      'Standard curve R² above 0.995 on every plate.',
    ],
    next: [
      'Report to the sending lab for the transfer report.',
      'Run the same controls with the second kit lot.',
    ],
    prep: [
      'Equilibrate kit to room temperature',
      'Prepare the standard curve dilutions',
      'Print the plate map',
    ],
    holdReason: 'Waiting for the second kit lot to arrive.',
    topics: [
      {
        title: 'Accuracy and recovery',
        objective:
          'Show that spiked controls are recovered within 80 to 120 % in the receiving lab.',
      },
      {
        title: 'Intermediate precision',
        objective:
          'Show that the controls repeat across analysts and days within the transfer limit.',
      },
      {
        title: 'Linearity and range',
        objective:
          'Confirm the assay is linear across the stated range using serial dilutions.',
        factor: 'Dilution',
        conditions: ['1:2', '1:4', '1:8', '1:16'],
      },
      {
        title: 'Kit lot comparison',
        objective: 'Compare two kit lots on the same samples.',
        factor: 'Kit lot',
        conditions: ['Lot 1', 'Lot 2', 'Lot 3'],
      },
      {
        title: 'Matrix effect in clarified harvest',
        objective:
          'Check that clarified harvest does not change the standard curve.',
        factor: 'Matrix',
        conditions: ['Buffer', 'Harvest 1:10', 'Harvest 1:50'],
      },
    ],
  },
  plasmid: {
    factor: 'Lot',
    conditions: ['Lot PL-0412', 'Lot PL-0413', 'Lot PL-0414'],
    readouts: [
      { name: 'Supercoiled', unit: '%', base: 91, spread: 0.04, digits: 1 },
      {
        name: 'Endotoxin',
        unit: 'EU/mg',
        base: 4.5,
        spread: 0.3,
        digits: 1,
        higherIsBetter: false,
      },
    ],
    method:
      'Plasmid lots tested against the release specification: concentration and A260/A280 by spectrophotometry, supercoiled fraction by capillary electrophoresis, endotoxin by LAL, identity by restriction digest.',
    quirks: [
      'A260/A280 between 1.85 and 1.90 for every lot.',
      'Restriction pattern matched the reference map.',
    ],
    next: [
      'Release the lots that pass and file the certificate.',
      'Quarantine any lot above the endotoxin limit.',
    ],
    prep: [
      'Thaw plasmid aliquots on ice',
      'Prepare LAL standards',
      'Order restriction enzymes if low',
    ],
    holdReason: 'Waiting for the endotoxin reagent delivery.',
    topics: [
      {
        title: 'Release panel, lots PL-0412 to 0414',
        objective:
          'Test three plasmid lots against the release specification before use in transfection.',
      },
      {
        title: 'Release panel, lots PL-0415 to 0417',
        objective:
          'Test the next three plasmid lots against the release specification.',
      },
      {
        title: 'Release panel, repeat for out-of-limit lot',
        objective:
          'Repeat the panel on the lot that read above the endotoxin limit to see whether the first result was real.',
      },
      {
        title: 'Release panel, helper plasmids',
        objective:
          'Test the rep-cap and helper plasmid lots against the release specification.',
      },
    ],
  },
  aav8Tff: {
    factor: 'Setting',
    conditions: ['200 L/m²', '300 L/m²', '400 L/m²', '500 L/m²'],
    readouts: [
      yieldPct(94),
      { name: 'Flux', unit: 'LMH', base: 34, spread: 0.12, digits: 1 },
      {
        name: 'Concentration factor',
        unit: '×',
        base: 10,
        spread: 0.1,
        digits: 1,
      },
    ],
    method:
      'Clarified AAV8 harvest was concentrated 10× on a 100 kDa Hydrosart cassette at 1.0 bar transmembrane pressure and diafiltered against 5 diavolumes of formulation buffer. Titre by ddPCR before and after.',
    quirks: [
      'Retentate was clear throughout.',
      'No loss of titre in the permeate within assay variation.',
      'Pressure drop stayed below 0.3 bar.',
    ],
    next: [
      'Fix the load at this setting for the pilot-scale run.',
      'Move to a 0.1 m² cassette to test scalability.',
    ],
    prep: [
      'Flush and integrity-test the cassette',
      'Prepare diafiltration buffer',
      'Sample clarified feed for titre',
    ],
    holdReason: 'Waiting for the replacement cassette lot.',
    topics: [
      {
        title: 'Membrane load screen',
        objective:
          'Find the highest load per square metre of cassette that keeps yield above 90 %.',
      },
      {
        title: 'Transmembrane pressure screen',
        objective: 'Compare 0.5, 1.0 and 1.5 bar for flux and yield.',
        factor: 'TMP',
        conditions: ['0.5 bar', '1.0 bar', '1.5 bar'],
      },
      {
        title: 'Cross-flow rate',
        objective:
          'Compare cross-flow rates of 3, 5 and 7 L/min/m² for flux and shear.',
        factor: 'Cross-flow',
        conditions: ['3 L/min/m²', '5 L/min/m²', '7 L/min/m²'],
      },
      {
        title: 'Diafiltration volumes',
        objective:
          'Find the fewest diavolumes that clear host-cell protein to target.',
        factor: 'Diavolumes',
        conditions: ['3 DV', '5 DV', '7 DV'],
        readouts: [
          {
            name: 'Host-cell protein',
            unit: 'ng/mL',
            base: 120,
            spread: 0.3,
            digits: 0,
            higherIsBetter: false,
          },
          yieldPct(95),
        ],
      },
      {
        title: 'Membrane cut-off, 100 vs 300 kDa',
        objective: 'Compare 100 and 300 kDa cassettes for yield and flux.',
        factor: 'Cut-off',
        conditions: ['100 kDa', '300 kDa', '100 kDa, new lot'],
      },
      {
        title: 'Buffer composition for diafiltration',
        objective:
          'Compare three formulation buffers for aggregation after concentration.',
        factor: 'Buffer',
        conditions: [
          'PBS + 0.001 % F68',
          'Tris + 0.001 % F68',
          'PBS + sucrose',
        ],
        readouts: [
          {
            name: 'Aggregates',
            unit: '%',
            base: 4,
            spread: 0.3,
            digits: 1,
            higherIsBetter: false,
          },
          yieldPct(93),
        ],
      },
      {
        title: 'Recirculation time',
        objective:
          'Check whether longer recirculation before concentration changes yield.',
        factor: 'Recirculation',
        conditions: ['5 min', '15 min', '30 min'],
      },
      {
        title: 'Cassette reuse',
        objective: 'Check yield on a cassette after one clean and store cycle.',
        factor: 'Use',
        conditions: ['New', 'Reused once', 'Reused twice'],
      },
      {
        title: 'Surfactant dose',
        objective:
          'Compare 0.0005, 0.001 and 0.002 % poloxamer 188 for loss to surfaces.',
        factor: 'Poloxamer',
        conditions: ['0.0005 %', '0.001 %', '0.002 %'],
      },
      {
        title: 'Final concentration limit',
        objective:
          'Push the concentration factor to 20× to see where aggregation starts.',
        factor: 'Factor',
        conditions: ['10×', '15×', '20×'],
      },
      {
        title: 'Confirmation at pilot load',
        objective:
          'Run the chosen setting on a second harvest lot to confirm it holds.',
        factor: 'Harvest lot',
        conditions: ['Lot 1', 'Lot 2', 'Lot 3'],
      },
    ],
  },
  tcell: {
    factor: 'Reagent',
    conditions: [
      'Bead reagent',
      'Soluble antibody',
      'Nanomatrix',
      'No reagent',
    ],
    readouts: [
      { name: 'CD25+ cells', unit: '%', base: 78, spread: 0.12, digits: 1 },
      { name: 'Fold expansion', unit: '×', base: 28, spread: 0.2, digits: 0 },
    ],
    method:
      'Pan T cells from healthy donor PBMC were activated for 48 h with each reagent at the manufacturer’s ratio, then expanded for 8 days in X-VIVO 15 with IL-2. Activation markers by flow on day 2.',
    quirks: [
      'Bead removal added a viability loss of about 3 %.',
      'No-reagent control stayed below 5 % CD25+.',
    ],
    next: [
      'Take the best reagent into the media screen.',
      'Check cost per dose before choosing.',
    ],
    prep: [
      'Isolate T cells from the donor PBMC',
      'Prepare reagent dilutions',
      'Set up the flow panel',
    ],
    holdReason: 'Paused while the reagent lot is re-qualified.',
    topics: [
      {
        title: 'Reagent comparison, donor 1',
        objective:
          'Compare four activation reagents on CD25 expression and expansion in donor 1.',
      },
      {
        title: 'Reagent comparison, donor 2',
        objective: 'Repeat the reagent comparison in donor 2.',
      },
      {
        title: 'Reagent comparison, donor 3',
        objective: 'Repeat the reagent comparison in donor 3.',
      },
      {
        title: 'Bead-to-cell ratio',
        objective:
          'Find the bead-to-cell ratio that gives the best activation.',
        factor: 'Ratio',
        conditions: ['1:2', '1:1', '2:1'],
      },
      {
        title: 'Activation duration',
        objective: 'Compare 24, 48 and 72 h of activation before removal.',
        factor: 'Duration',
        conditions: ['24 h', '48 h', '72 h'],
      },
      {
        title: 'Cytokine combination',
        objective: 'Compare IL-2 alone with IL-7 and IL-15 combinations.',
        factor: 'Cytokines',
        conditions: ['IL-2', 'IL-7 + IL-15', 'IL-2 + IL-7'],
      },
      {
        title: 'Cryopreserved vs fresh PBMC',
        objective: 'Check that cryopreserved PBMC activate as well as fresh.',
        factor: 'Source',
        conditions: ['Fresh', 'Frozen, 1 month', 'Frozen, 6 months'],
      },
      {
        title: 'Cost and handling summary',
        objective:
          'Time the hands-on steps for each reagent and compare with the activation data.',
        factor: 'Reagent',
        conditions: ['Bead reagent', 'Soluble antibody', 'Nanomatrix'],
      },
    ],
  },
  lvvChrom: {
    factor: 'Condition',
    conditions: [
      'Resin A, pH 7.0',
      'Resin A, pH 8.0',
      'Resin B, pH 7.0',
      'Resin B, pH 8.0',
    ],
    readouts: [
      yieldPct(72),
      {
        name: 'Residual DNA',
        unit: 'ng/mL',
        base: 45,
        spread: 0.3,
        digits: 0,
        higherIsBetter: false,
      },
    ],
    method:
      'Clarified, benzonase-treated LVV supernatant was loaded on anion-exchange resin, washed and eluted on a 0.2 to 1.0 M NaCl gradient. Infectious titre before and after; residual DNA by PicoGreen.',
    quirks: [
      'Infectious titre dropped sharply above 0.6 M NaCl.',
      'Pressure stayed under the column limit.',
    ],
    next: [
      'Resume once the project is back on.',
      'Use a shorter gradient on the next trial.',
    ],
    prep: [
      'Pack and test the column',
      'Equilibrate with five column volumes',
      'Prepare the salt gradient',
    ],
    holdReason:
      'Project on hold while the client reviews the downstream strategy.',
    topics: [
      {
        title: 'Resin screen, first resin',
        objective:
          'Compare two anion-exchange resins at two pH values for recovery of infectious vector.',
      },
      {
        title: 'Salt gradient slope',
        objective: 'Compare linear gradients of 10, 20 and 30 column volumes.',
        factor: 'Gradient',
        conditions: ['10 CV', '20 CV', '30 CV'],
      },
      {
        title: 'Load density',
        objective: 'Compare loads of 1, 2 and 3 × 10⁹ TU per mL of resin.',
        factor: 'Load',
        conditions: ['1 × 10⁹ TU/mL', '2 × 10⁹ TU/mL', '3 × 10⁹ TU/mL'],
      },
      {
        title: 'Flow rate',
        objective: 'Compare residence times of 2, 4 and 8 minutes.',
        factor: 'Residence time',
        conditions: ['2 min', '4 min', '8 min'],
      },
      {
        title: 'Wash stringency',
        objective: 'Find the highest wash salt that does not strip vector.',
        factor: 'Wash salt',
        conditions: ['0.2 M', '0.3 M', '0.4 M'],
      },
      {
        title: 'Elution buffer additives',
        objective:
          'Compare sucrose and trehalose in the elution buffer for stability.',
        factor: 'Additive',
        conditions: ['None', '5 % sucrose', '5 % trehalose'],
      },
      {
        title: 'Benzonase dose before loading',
        objective:
          'Find the benzonase dose that clears DNA without hurting titre.',
        factor: 'Benzonase',
        conditions: ['25 U/mL', '50 U/mL', '100 U/mL'],
      },
      {
        title: 'Hold of eluate',
        objective:
          'Check titre of the eluate held at 2–8 °C for 4, 8 and 24 h.',
        factor: 'Hold',
        conditions: ['4 h', '8 h', '24 h'],
      },
      {
        title: 'Column re-use',
        objective: 'Compare recovery on cycle 1, 5 and 10 of the same column.',
        factor: 'Cycle',
        conditions: ['Cycle 1', 'Cycle 5', 'Cycle 10'],
      },
      {
        title: 'Sanitisation with NaOH',
        objective:
          'Check that 0.5 M NaOH sanitisation does not change recovery.',
        factor: 'Clean',
        conditions: ['None', '0.1 M NaOH', '0.5 M NaOH'],
      },
      {
        title: 'Loading at pH 7.5',
        objective: 'Compare loading at pH 7.0, 7.5 and 8.0.',
        factor: 'Load pH',
        conditions: ['pH 7.0', 'pH 7.5', 'pH 8.0'],
      },
      {
        title: 'Pool collection window',
        objective:
          'Set the pooling window by comparing 3 cut points on the UV trace.',
        factor: 'Cut point',
        conditions: ['10 % of peak', '20 % of peak', '30 % of peak'],
      },
      {
        title: 'Second capture step trial',
        objective:
          'Try a polishing step after the capture column and measure what is gained.',
        factor: 'Polish',
        conditions: ['None', 'Hydroxyapatite', 'Size exclusion'],
      },
      {
        title: 'Confirmation on a second harvest',
        objective: 'Confirm the best conditions on a second harvest lot.',
        factor: 'Harvest',
        conditions: ['Lot 1', 'Lot 2', 'Lot 3'],
      },
    ],
  },
  aav1: {
    factor: 'Construct',
    conditions: ['Construct A', 'Construct B', 'Construct C'],
    readouts: [
      titre(4.2),
      {
        name: 'Transduction',
        unit: '% GFP+',
        base: 62,
        spread: 0.15,
        digits: 1,
      },
    ],
    method:
      'Vector constructs were packaged in AAV1 by triple transfection, purified by iodixanol gradient and titred by ddPCR. Transduction measured by GFP expression in HEK293 and primary myoblasts.',
    quirks: [
      'Packaging efficiency differed between constructs by less than twofold.',
    ],
    next: [
      'Take the best construct to the process-development team.',
      'Test in the second cell type.',
    ],
    prep: [
      'Verify plasmid sequences',
      'Prepare iodixanol steps',
      'Plate target cells',
    ],
    holdReason: 'Paused; the programme has moved to AAV9.',
    topics: [
      {
        title: 'Promoter comparison',
        objective:
          'Compare three promoters driving GFP for expression in myoblasts.',
      },
      {
        title: 'Packaging yield by construct',
        objective:
          'Compare packaging yield for three constructs at the same plasmid ratio.',
      },
    ],
  },
}

/** Which kit each project's numbered runs draw from. */
export const KIT_FOR_PROJECT: Record<string, keyof typeof KITS> = {
  'aav9-process-transfer': 'aav9',
  'legacy-gareth-aav9-old': 'aav9',
  'lvv-stability-2-8c': 'lvvStability',
  'car-t-expansion-media-screen': 'cart',
  'legacy-car-t-old': 'cart',
  'aav-full-empty-assay-qualification': 'fullEmpty',
  'legacy-capsid-qc-old': 'fullEmpty',
  'ambr-250-perfusion-scale-down': 'ambr',
  'legacy-ambr-old': 'ambr',
  'lvv-transfection-optimisation': 'lvvTransfection',
  'legacy-lentiviral-titration': 'lvvTransfection',
  'hek293-cell-bank-characterisation': 'hek293',
  'legacy-hek293-expansion-old': 'hek293',
  'capsid-elisa-method-transfer': 'elisa',
  'legacy-elisa-old': 'elisa',
  'plasmid-lot-release-panel': 'plasmid',
  'legacy-plasmid-old': 'plasmid',
  'aav8-tff-concentration': 'aav8Tff',
  'legacy-aav8-old': 'aav8Tff',
  't-cell-activation-reagent-comparison': 'tcell',
  'legacy-tcell-old': 'tcell',
  'lvv-downstream-chromatography': 'lvvChrom',
  'legacy-lvv-chromatography-old': 'lvvChrom',
  'legacy-aav1-vector-design': 'aav1',
}

/**
 * Experiments the design names, with the question each one answers. The title
 * stays as the design has it; the topic supplies what was being asked and how
 * the work was set up.
 */
export const NAMED_TOPICS: Record<string, Omit<Topic, 'title'>> = {
  'EXP-0091': {
    objective:
      'Screen three clarification options on a small harvest volume before the Ambr runs start.',
    factor: 'Clarification',
    conditions: ['Depth filter', 'Centrifuge', 'Depth + 0.45 µm'],
    readouts: [
      yieldPct(88),
      {
        name: 'Turbidity',
        unit: 'NTU',
        base: 9,
        spread: 0.3,
        digits: 1,
        higherIsBetter: false,
      },
    ],
  },
  'EXP-0098': {
    objective:
      'Run the first TFF concentration on clarified Ambr harvest to set a starting load and flux.',
  },
  'EXP-0117': {
    objective:
      'Run the first batch of four Ambr 250 vessels with the standard perfusion process to see how well it reproduces.',
  },
  'EXP-0119': {
    objective:
      'Qualify the Ambr 250 scale-down model against the 50 L bioreactor on growth, viability and titre.',
    factor: 'Scale',
    conditions: ['Ambr 250', '50 L reference'],
    readouts: [
      titre(6.4),
      viability(92),
      {
        name: 'Peak cell density',
        unit: '× 10⁶/mL',
        base: 36,
        spread: 0.06,
        digits: 1,
      },
    ],
  },
  'EXP-0121': {
    objective:
      'Find the glucose feed rate that avoids both starvation and lactate build-up.',
    factor: 'Glucose feed',
    conditions: ['2 g/L/day', '3 g/L/day', '4 g/L/day', '6 g/L/day'],
    readouts: [
      {
        name: 'Peak cell density',
        unit: '× 10⁶/mL',
        base: 36,
        spread: 0.12,
        digits: 1,
      },
      {
        name: 'Peak lactate',
        unit: 'mM',
        base: 22,
        spread: 0.3,
        digits: 1,
        higherIsBetter: false,
      },
    ],
  },
  'EXP-0123': {
    objective:
      'Check that the infectious titre method reads the same on two analysts’ plates before it is used for the stability study.',
    factor: 'Analyst',
    conditions: ['Analyst 1', 'Analyst 2', 'Analyst 3'],
  },
  'EXP-0124': {
    objective:
      'Establish the day 0 reference for LVV harvest H-21 before any aliquot goes into the 2–8 °C hold.',
    factor: 'Aliquot',
    conditions: ['Fresh', 'Frozen at −80 °C', 'Frozen, thawed twice'],
  },
  'EXP-0125': {
    objective:
      'Measure the full-to-empty capsid ratio of three AAV9 lots by analytical ultracentrifugation.',
    factor: 'Lot',
    conditions: ['AAV9 lot 1', 'AAV9 lot 2', 'AAV9 lot 3'],
  },
  'EXP-0126': {
    objective:
      'See how long CAR-T harvest medium can be held before cells are taken for the media screen.',
    factor: 'Hold',
    conditions: ['0 h', '4 h', '8 h', '24 h'],
  },
  'EXP-0127': {
    objective:
      'Measure infectious titre and p24 three days after harvest as the day 3 point of the hold study.',
  },
  'EXP-0128': {
    objective:
      'Compare expansion media A and B for CD3+ cell expansion from one donor.',
    factor: 'Medium',
    conditions: ['Medium A', 'Medium B', 'Current medium'],
  },
  'EXP-0129': {
    objective:
      'Screen anion-exchange gradients for separation of full and empty capsids.',
    factor: 'Gradient',
    conditions: ['10 CV', '20 CV', '30 CV'],
    readouts: [
      { name: 'Full capsids', unit: '%', base: 74, spread: 0.1, digits: 0 },
      yieldPct(70),
    ],
  },
  'EXP-0130': {
    objective:
      'Run the viability panel on the HEK293 working cell bank vials as part of bank characterisation.',
  },
  'EXP-0131': {
    objective:
      'Measure infectious titre and p24 seven days after harvest as the day 7 point of the hold study.',
  },
  'EXP-0132': {
    objective:
      'Run Ambr 250 batch AMB-25-112 with the extended perfusion setting to see if cell density holds past day 10.',
  },
  'EXP-0133': {
    objective:
      'Determine the harvest timepoint that maximises genome titre without compromising capsid integrity.',
    factor: 'Harvest time',
    conditions: ['48 h', '72 h', '96 h'],
  },
  'EXP-0134': {
    objective:
      'Check how long prepared medium can be held at 2–8 °C before it starts to lose growth support.',
    factor: 'Hold',
    conditions: ['Fresh', '1 week', '2 weeks', '4 weeks'],
  },
  'EXP-0136': {
    objective:
      'Compare 1.5, 2.0 and 2.5 × 10⁶ cells/mL seeding densities for transfection productivity and viability.',
    factor: 'Seeding density',
    conditions: ['1.5 × 10⁶/mL', '2.0 × 10⁶/mL', '2.5 × 10⁶/mL'],
  },
  'EXP-0137': {
    objective: 'Repeat the seeding density comparison at CAR-T flask scale.',
    factor: 'Seeding density',
    conditions: ['0.5 × 10⁶/mL', '1.0 × 10⁶/mL', '1.5 × 10⁶/mL'],
  },
  'EXP-0138': {
    objective:
      'Find the PEI:DNA ratio (w/w) that maximises AAV9 genome titre in HEK293 suspension culture at 1.0 µg DNA per mL, without viability at harvest falling below 80 %.',
    factor: 'PEI:DNA (w/w)',
    conditions: ['1.5:1', '2:1', '2.5:1', '3:1'],
  },
  'EXP-0139': {
    objective: 'Screen four AEX resins for capture of AAV9 full capsids.',
    factor: 'Resin',
    conditions: ['Resin A', 'Resin B', 'Resin C', 'Resin D'],
    readouts: [
      yieldPct(76),
      { name: 'Full capsids', unit: '%', base: 68, spread: 0.1, digits: 0 },
    ],
  },
  'EXP-0140': {
    objective:
      'Run Ambr 250 batch AMB-25-118 with the higher glucose feed chosen in the feed optimisation.',
  },
  'EXP-0141': {
    objective:
      'Check that clarification yield holds on the second harvest lot before the CAR-T media screen resumes.',
    factor: 'Harvest lot',
    conditions: ['Lot 1', 'Lot 2', 'Lot 3'],
    readouts: [
      yieldPct(90),
      {
        name: 'Turbidity',
        unit: 'NTU',
        base: 7,
        spread: 0.3,
        digits: 1,
        higherIsBetter: false,
      },
    ],
  },
  'EXP-0144': {
    objective:
      'Repeat the TFF concentration with the load chosen in run 1, on a 0.1 m² cassette.',
  },
  'EXP-0145': {
    objective:
      'Confirm the depth filter train chosen in EXP-0142 on a 50 L harvest.',
    factor: 'Filter train',
    conditions: ['Train B', 'Train A'],
  },
  'EXP-0146': {
    objective:
      'Follow up the seeding density comparison with a narrower range around the best density.',
    factor: 'Seeding density',
    conditions: ['0.8 × 10⁶/mL', '1.0 × 10⁶/mL', '1.2 × 10⁶/mL'],
  },
  'CCR-0001': {
    objective:
      'Expand a thawed HEK293 working cell bank vial in shake flasks to the cell number needed for the next transfection.',
    factor: 'Passage',
    conditions: ['P1', 'P2', 'P3'],
    readouts: [
      viability(96),
      {
        name: 'Cell density',
        unit: '× 10⁶/mL',
        base: 4.2,
        spread: 0.1,
        digits: 1,
      },
    ],
  },
}

/** Which kit a named experiment draws its defaults from, by its project. */
export function kitFor(projectKey: string): Kit {
  return KITS[KIT_FOR_PROJECT[projectKey] ?? 'aav9']
}
