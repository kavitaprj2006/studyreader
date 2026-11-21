"""
Dataset Generator for StudyReader Academic Subject Classification.
Generates a diverse, realistic, and balanced dataset of academic texts
covering both School (grades 9-12) and College / University curriculum.
"""

import os
import random
import pandas as pd

SUBJECT_PROFILES = {
    "Mathematics": {
        "educational_level": "school",
        "category": "STEM",
        "topics": [
            "Calculus and differential equations",
            "Linear algebra, matrices, and determinants",
            "Trigonometric identities and coordinate geometry",
            "Probability distributions and statistical hypothesis testing",
            "Polynomials, quadratic equations, and complex numbers",
            "Sequences, series, arithmetic and geometric progressions",
            "Integration techniques, definite integrals, and area under curves",
            "Vectors, three-dimensional geometry, and planes",
        ],
        "keywords": [
            "derivative", "integral", "matrix", "eigenvalue", "determinant", "trigonometry",
            "sine", "cosine", "tangent", "quadratic", "polynomial", "probability", "mean",
            "variance", "standard deviation", "limit", "continuity", "differentiability",
            "vector", "dot product", "cross product", "logarithm", "exponent", "binomial theorem",
            "permutation", "combination", "parabola", "hyperbola", "ellipse", "theorem"
        ],
        "templates": [
            "Let f(x) be a continuous and differentiable function on the interval [a, b]. According to Rolle's theorem and the Mean Value Theorem, there exists at least one point c such that f'(c) equals zero. We evaluate the definite integral from 0 to pi of sin(x) cos(x) dx using substitution.",
            "Solve the system of linear equations using Cramer's rule and matrix inversion method. Given the matrix A with dimensions 3x3, find its determinant, cofactor matrix, and verify whether the matrix is singular or invertible. Calculate the eigenvalues and corresponding eigenvectors.",
            "In coordinate geometry, the equation of the parabola with vertex at the origin and focus at (a, 0) is y^2 = 4ax. Determine the length of the latus rectum and find the tangent and normal lines passing through the given point on the curve.",
            "Consider a discrete random variable X following a binomial distribution with parameters n and p. Compute the mathematical expectation, variance, and the probability of obtaining at least three successes out of ten independent trials using combinations.",
            "Evaluate the limit as x approaches zero of (sin(x) - x) / x^3 using L'Hopital's Rule. Differentiate the implicit function x^3 + y^3 = 3axy with respect to x and find the second derivative at the point where x equals a.",
            "Find the sum of the first n terms of an arithmetic progression where the first term is a and common difference is d. Prove by mathematical induction that the sum of squares of first n natural numbers equals n(n+1)(2n+1)/6.",
            "Find the general solution of the second order ordinary differential equation d^2y/dx^2 + 5 dy/dx + 6y = 0. Identify the characteristic equation, find the roots, and apply initial boundary conditions y(0) = 1 and y'(0) = 0.",
            "Trigonometric reduction formulas allow simplification of angles in all four quadrants. Express tan(A + B) in terms of tan(A) and tan(B) and prove the identity involving double angle and half angle formulas.",
        ]
    },
    "Physics": {
        "educational_level": "school",
        "category": "STEM",
        "topics": [
            "Classical mechanics and Newton's laws of motion",
            "Thermodynamics, heat transfer, and entropy",
            "Wave optics, interference, and diffraction",
            "Electromagnetism, Coulomb's law, and Faraday's induction",
            "Rotational dynamics, moment of inertia, and angular momentum",
            "Quantum physics, photoelectric effect, and de Broglie wavelength",
            "Gravitation, planetary motion, and Kepler's laws",
            "Current electricity, Ohm's law, and Kirchhoff's rules",
        ],
        "keywords": [
            "velocity", "acceleration", "force", "momentum", "kinetic energy", "potential energy",
            "friction", "gravitation", "thermodynamics", "entropy", "carnot engine", "electric field",
            "magnetic flux", "induction", "solenoid", "capacitance", "dielectric", "refraction",
            "diffraction", "interference", "wavelength", "frequency", "photon", "photoelectric",
            "work function", "angular momentum", "torque", "moment of inertia", "kirchhoff"
        ],
        "templates": [
            "According to Newton's second law of motion, the rate of change of momentum of a body is directly proportional to the applied unbalanced force. A block of mass m slides down an inclined plane of inclination theta with kinetic friction coefficient mu.",
            "In electrostatics, Coulomb's law states that the force between two point charges is inversely proportional to the square of the distance between them. Calculate the electric field intensity and potential due to an electric dipole along its axial and equatorial lines.",
            "Faraday's law of electromagnetic induction states that the induced electromotive force in any closed circuit is equal to the negative rate of change of the magnetic flux through the circuit. Lenz's law gives the direction of the induced current.",
            "The first law of thermodynamics is a formulation of the principle of conservation of energy: delta Q = delta U + delta W. In an adiabatic process, no heat enters or leaves the thermodynamic system, and PV^gamma remains constant.",
            "Young's double-slit experiment demonstrates the wave nature of light through interference fringes. Calculate the fringe width beta = lambda * D / d and determine the phase difference between two coherent monochromatic light waves.",
            "The photoelectric effect demonstrates the particle nature of electromagnetic radiation. Albert Einstein explained that photons of energy h*nu incident on a photosensitive metal surface emit electrons with maximum kinetic energy equal to h*nu minus the work function.",
            "Derive Kepler's three laws of planetary motion from Newton's universal law of gravitation. Calculate the escape velocity of an object from Earth's surface and the orbital velocity of a geostationary satellite.",
            "Kirchhoff's current law states that the algebraic sum of currents entering any electrical junction is zero. Using Kirchhoff's loop rule, analyze the Wheatstone bridge circuit to determine the balanced bridge condition R1/R2 = R3/R4.",
        ]
    },
    "Chemistry": {
        "educational_level": "school",
        "category": "STEM",
        "topics": [
            "Organic chemistry and reaction mechanisms (SN1, SN2)",
            "Chemical bonding, hybridization, and molecular orbital theory",
            "Chemical equilibrium, Le Chatelier's principle, and pH",
            "Electrochemistry, Nernst equation, and galvanic cells",
            "Periodic table, periodic trends, and coordination compounds",
            "Chemical kinetics, reaction rate, and Arrhenius equation",
            "States of matter, ideal gas equation, and intermolecular forces",
            "Thermodynamics, enthalpy, Gibbs free energy, and spontaneity",
        ],
        "keywords": [
            "atom", "molecule", "covalent", "ionic", "hybridization", "orbital", "valence",
            "enthalpy", "entropy", "gibbs free energy", "equilibrium", "le chatelier", "acid", "base",
            "ph", "buffer", "electronegativity", "oxidation", "reduction", "galvanic", "anode",
            "cathode", "nernst", "organic", "alkane", "alkene", "alkyne", "nucleophile", "electrophile",
            "carbocation", "sn1", "sn2", "coordination", "ligand", "isomerism", "catalyst"
        ],
        "templates": [
            "Nucleophilic substitution reactions proceed via SN1 or SN2 mechanisms depending on the structure of the alkyl halide. Tertiary haloalkanes favor the two-step unimolecular SN1 pathway via a planar carbocation intermediate with racemization of configuration.",
            "Valence bond theory and hybridization explain the tetrahedral geometry of methane (sp3), trigonal planar geometry of ethene (sp2), and linear geometry of ethyne (sp). Molecular orbital theory accounts for the paramagnetic behavior of oxygen molecules.",
            "According to Le Chatelier's principle, if a dynamic equilibrium is disturbed by changing the conditions, the position of equilibrium shifts to counteract the change. An increase in pressure favors the side of the reaction with fewer moles of gas.",
            "In electrochemistry, the Daniel cell consists of zinc and copper electrodes dipped in their respective sulfate solutions. Write the half-cell reactions, calculate the standard electrode potential E_cell, and apply the Nernst equation at 298 Kelvin.",
            "Transition metals exhibit variable oxidation states and form colored coordination compounds due to d-d electron transitions. Crystal field theory explains the splitting of degenerate d-orbitals into t2g and eg sets in an octahedral coordination complex.",
            "Chemical kinetics investigates the rate of chemical reactions. For a first-order reaction, the half-life period t_1/2 is independent of the initial concentration of reactants: t_1/2 = 0.693 / k. The Arrhenius equation relates reaction rate constant to activation energy.",
            "Calculate the pH of a buffer solution consisting of a weak acid and its conjugate base using the Henderson-Hasselbalch equation. Determine the solubility product constant Ksp for sparingly soluble salts in aqueous solutions.",
            "Standard enthalpy of formation, entropy change, and Gibbs free energy delta G = delta H - T delta S determine reaction spontaneity. A chemical reaction is spontaneous under constant temperature and pressure when delta G is negative.",
        ]
    },
    "Biology": {
        "educational_level": "school",
        "category": "STEM",
        "topics": [
            "Cell biology, organelles, and cell division (mitosis/meiosis)",
            "Molecular genetics, DNA replication, transcription, and translation",
            "Human physiology, circulatory, and nervous systems",
            "Plant physiology, photosynthesis, and transpiration",
            "Ecology, ecosystems, biodiversity, and conservation",
            "Evolutionary biology, natural selection, and speciation",
            "Immunology, pathogens, antibodies, and vaccination",
            "Reproduction, gametogenesis, and embryonic development",
        ],
        "keywords": [
            "cell", "mitosis", "meiosis", "chromosome", "dna", "rna", "transcription", "translation",
            "gene", "allele", "genotype", "phenotype", "enzyme", "protein", "mitochondria",
            "chloroplast", "photosynthesis", "calvin cycle", "respiration", "atp", "neuron",
            "synapse", "hormone", "antibody", "antigen", "immune", "ecosystem", "trophic",
            "natural selection", "adaptation", "species", "cardiovascular", "hemoglobin"
        ],
        "templates": [
            "Mitosis is the process of nuclear division in eukaryotic cells that produces two genetically identical daughter cells through prophase, metaphase, anaphase, and telophase. Meiosis introduces genetic variation through homologous crossing over during pachytene.",
            "DNA replication follows a semiconservative model orchestrated by DNA polymerase, helicase, and RNA primase. During protein synthesis, mRNA is transcribed from the template DNA strand and subsequently translated by ribosomes into polypeptide chains.",
            "The human cardiovascular system transports oxygenated blood from the left ventricle through the systemic circulation via the aorta. Cardiac cycle phases include ventricular systole and diastole regulated by the sinoatrial node pacemaker.",
            "Photosynthesis in green plants occurs in two stages: light-dependent reactions in the thylakoid membranes generating ATP and NADPH, and the Calvin cycle in the stroma fixing carbon dioxide into glucose via the RuBisCO enzyme.",
            "Ecosystem dynamics rely on trophic levels where energy flows from primary producers to apex predators following Lindeman's 10 percent energy transfer rule. Biogeochemical cycles circulate carbon, nitrogen, and phosphorus through biotic and abiotic reservoirs.",
            "Mendel's laws of inheritance include the Law of Segregation and the Law of Independent Assortment. Monohybrid crosses yield a 3:1 phenotypic ratio in the F2 generation, while dihybrid crosses produce a characteristic 9:3:3:1 phenotypic distribution.",
            "The immune system comprises innate and adaptive branches. B lymphocytes produce antigen-specific antibodies that neutralize pathogens, while cytotoxic T cells identify and destroy virus-infected host cells presenting MHC class I molecules.",
            "Neurons communicate via electrical action potentials and chemical neurotransmitters across synaptic clefts. Depolarization is mediated by voltage-gated sodium channels followed by repolarization through potassium ion efflux.",
        ]
    },
    "English Literature": {
        "educational_level": "school",
        "category": "Humanities",
        "topics": [
            "Shakespearean drama, tragedy, and character soliloquies",
            "Romantic and Victorian poetry analysis and meter",
            "Prose comprehension, essay writing, and rhetorical devices",
            "Grammar, clauses, active-passive voice, and indirect speech",
            "Narrative techniques, symbolism, allegory, and theme exploration",
            "Literary movements: Modernism, Realism, and Romanticism",
            "Critical appreciation of classic novels and novellas",
            "Figures of speech: metaphor, simile, personification, and hyperbole",
        ],
        "keywords": [
            "poem", "poetry", "stanza", "metaphor", "simile", "alliteration", "soliloquy",
            "tragedy", "protagonist", "antagonist", "irony", "symbolism", "allegory", "rhyme",
            "iambic pentameter", "sonnet", "narrator", "perspective", "theme", "characterization",
            "imagery", "hyperbole", "personification", "diction", "tone", "clause", "conjunction",
            "syntax", "essay", "rhetoric", "foreshadowing", "catharsis", "hubris"
        ],
        "templates": [
            "In William Shakespeare's tragedy Macbeth, the protagonist's soliloquy 'Tomorrow, and tomorrow, and tomorrow' reflects his existential despair and nihilistic realization of life's futility following Lady Macbeth's death. The imagery of shadows underscores mortality.",
            "Analyze the theme of nature versus industrialization in the Romantic poetry of William Wordsworth and Samuel Taylor Coleridge. The use of pastoral imagery and personification celebrates the sublime beauty of the natural world against mechanical corruption.",
            "Identify and explain the figures of speech employed in the stanza: 'The wild winds wept, the sea shrieked aloud, and silence fell like a leaden shroud.' The author combines pathetic fallacy with alliteration and simile to evoke an atmosphere of foreboding.",
            "Convert the following complex sentence from direct to indirect speech, ensuring appropriate pronoun shifts and tense concordance: 'The professor remarked, \"If you complete the literary dissertation by Friday, you will achieve high honors.\"'",
            "The novel employs an unreliable first-person narrator whose selective recollections create dramatic irony between the reader's perception and the events unfolding. Symbolism such as the green light across the harbor represents unreachable aspirations.",
            "Discuss the structural elements of a Petrarchan sonnet, examining the octave that establishes the thematic problem and the sestet that offers resolution following the pivotal volta at line nine, adhering to the ABBA ABBA CDECDE rhyme scheme.",
            "Explore the conflict between societal expectations and individual autonomy in Jane Austen's Pride and Prejudice. Elizabeth Bennet's sharp wit and independent judgment challenge patriarchal conventions of Regency-era England.",
            "Examine how the author utilizes foreshadowing and gothic motifs in the narrative to heighten suspense, emphasizing how decaying architecture mirrors the psychological disintegration of the central characters.",
        ]
    },
    "History & Civics": {
        "educational_level": "school",
        "category": "Humanities",
        "topics": [
            "The Indian National Movement, Gandhi, and Independence",
            "The French Revolution, Enlightenment, and Rise of Nationalism",
            "World War I, the Treaty of Versailles, and League of Nations",
            "World War II, Fascism, Nazism, and the Cold War",
            "The Constitution of India, Preamble, and Fundamental Rights",
            "Parliamentary democracy, Rajya Sabha, Lok Sabha, and Prime Minister",
            "Judiciary system, Supreme Court, judicial review, and writ petitions",
            "Ancient and Medieval civilizations: Indus Valley, Mauryas, Mughals",
        ],
        "keywords": [
            "revolution", "constitution", "parliament", "democracy", "monarchy", "treaty",
            "independence", "sovereignty", "nationalism", "fundamental rights", "directive principles",
            "judiciary", "supreme court", "amendment", "colonialism", "empire", "civilization",
            "satyagraha", "non-violence", "boycott", "freedom struggle", "cold war", "fascism",
            "allies", "axis", "legislation", "lok sabha", "rajya sabha", "cabinet", "preamble"
        ],
        "templates": [
            "The Non-Cooperation Movement launched by Mahatma Gandhi in 1920 mobilized millions against British colonial rule through the boycott of foreign goods, government schools, and courts. The movement was abruptly suspended following the violent Chauri Chaura incident in 1922.",
            "The French Revolution of 1789 dismantled the feudal Estates system and absolute monarchy of Louis XVI. Inspired by Enlightenment philosophers such as Rousseau, Voltaire, and Montesquieu, the National Assembly drafted the Declaration of the Rights of Man and of the Citizen.",
            "The Constitution of India is the supreme law of the land, drafted by the Constituent Assembly under the chairmanship of Dr. B.R. Ambedkar. The Preamble declares India to be a Sovereign, Socialist, Secular, Democratic Republic guaranteeing justice, liberty, and equality.",
            "Article 32 of the Indian Constitution grants citizens the Right to Constitutional Remedies, empowering the Supreme Court to issue prerogative writs including Habeas Corpus, Mandamus, Prohibition, Quo Warranto, and Certiorari for the enforcement of Fundamental Rights.",
            "The Treaty of Versailles in 1919 imposed harsh territorial, financial, and military reparations on Germany following World War I. The resulting economic instability and hyperinflation in the Weimar Republic facilitated the rise of Adolf Hitler and the National Socialist party.",
            "The Indian Parliament is a bicameral legislature comprising the President, the Lok Sabha (House of the People), and the Rajya Sabha (Council of States). Ordinary bills require passage by both houses and presidential assent, with money bills introduced exclusively in Lok Sabha.",
            "The Indus Valley Civilization demonstrated advanced town planning with grid-pattern brick houses, sophisticated drainage networks, granaries, and the Great Bath at Mohenjo-daro. Archaeological discoveries attest to extensive maritime trade with ancient Mesopotamia.",
            "During the Cold War, ideological rivalry between the democratic capitalist United States and the communist Soviet Union precipitated proxy conflicts, the nuclear arms race, and military alliances such as NATO and the Warsaw Pact without direct armed confrontation.",
        ]
    },
    "Economics": {
        "educational_level": "school",
        "category": "Humanities",
        "topics": [
            "Microeconomics: Law of Demand, Elasticity, and Consumer Surplus",
            "Production theory, Cost functions, and Perfect Competition vs Monopoly",
            "Macroeconomics: Gross Domestic Product (GDP), National Income, and Inflation",
            "Fiscal policy, Government Budget, and Public Debt",
            "Monetary policy, Central Bank (RBI), Repo rate, and Money supply",
            "International trade, Balance of Payments, and Exchange rates",
            "Economic development, Poverty indicators, and Human Development Index",
            "Market structures: Oligopoly, Monopolistic competition, and Cartels",
        ],
        "keywords": [
            "demand", "supply", "elasticity", "price", "equilibrium", "consumer surplus",
            "monopoly", "oligopoly", "competition", "marginal cost", "average revenue", "gdp",
            "inflation", "deflation", "national income", "fiscal policy", "monetary policy",
            "central bank", "repo rate", "cash reserve ratio", "balance of payments", "deficit",
            "subsidy", "taxation", "unemployment", "poverty", "investment", "interest rate"
        ],
        "templates": [
            "The Law of Demand states that, ceteris paribus, when the price of a good increases, its quantity demanded decreases. Price elasticity of demand measures the responsiveness of consumers to price changes, categorized into elastic, inelastic, and unitary elasticity.",
            "Gross Domestic Product (GDP) represents the total monetary value of all final goods and services produced within a country's geographical borders during a specific fiscal year. It can be measured via the output, expenditure, or income approach.",
            "In a perfectly competitive market structure, numerous buyers and sellers exist, products are homogeneous, and firms are price takers with free entry and exit. Long-run equilibrium occurs where price equals minimum average total cost and marginal cost.",
            "Monetary policy conducted by the Central Bank utilizes quantitative instruments including the Repo Rate, Reverse Repo Rate, Cash Reserve Ratio (CRR), and Statutory Liquidity Ratio (SLR) to regulate money supply, credit availability, and target inflation.",
            "Fiscal deficit occurs when the government's total expenditure exceeds total revenue excluding borrowings. High fiscal deficits can induce macroeconomic instability, crowding out private investment and accelerating sovereign debt accumulation.",
            "The Phillips curve illustrates the historical inverse relationship between the rate of inflation and the rate of unemployment in an economy. However, stagflation demonstrated that high inflation and high unemployment could co-occur during supply shocks.",
            "Balance of Payments (BOP) is a systematic statistical record of all economic transactions between residents of a country and the rest of the world. It consists of the Current Account tracking merchandise trade and services, and the Capital Account.",
            "Indifference curve analysis models consumer behavior based on ordinal utility theory. An indifference curve represents combinations of two commodities yielding equal satisfaction, characterized by a diminishing marginal rate of substitution (MRS).",
        ]
    },
    "Data Structures & Algorithms": {
        "educational_level": "college",
        "category": "STEM",
        "topics": [
            "Asymptotic analysis, Big-O, Big-Omega, and Big-Theta notation",
            "Arrays, Linked Lists (Singly, Doubly, Circular), and Skip Lists",
            "Stacks, Queues, Priority Queues, and Heap data structures",
            "Binary Trees, Binary Search Trees (BST), and AVL tree rotations",
            "Graph algorithms: BFS, DFS, Dijkstra, Bellman-Ford, and Floyd-Warshall",
            "Sorting algorithms: QuickSort, MergeSort, HeapSort, and RadixSort",
            "Dynamic Programming: Knapsack, LCS, LIS, and Matrix Chain Multiplication",
            "Hash tables, collision resolution techniques, and universal hashing",
        ],
        "keywords": [
            "array", "linked list", "stack", "queue", "binary tree", "bst", "avl", "red-black",
            "heap", "priority queue", "hash table", "hash map", "collision", "graph", "vertex",
            "edge", "bfs", "dfs", "dijkstra", "bellman-ford", "kruskal", "prim", "dynamic programming",
            "recursion", "memoization", "quicksort", "mergesort", "asymptotic", "big-o", "time complexity",
            "space complexity", "divide and conquer", "greedy algorithm", "backtracking"
        ],
        "templates": [
            "Analyze the worst-case, average-case, and best-case time complexity of QuickSort using the master theorem. The choice of pivot selection using median-of-three mitigates worst-case quadratic behavior O(n^2), ensuring expected O(n log n) performance.",
            "An AVL tree is a self-balancing binary search tree where the heights of the two child subtrees of any node differ by at most one. When an insertion violates the balance factor, left or right rotations (LL, RR, LR, RL) restore balanced properties in O(log n) time.",
            "Dijkstra's shortest path algorithm determines the minimum distance from a single source vertex to all other vertices in a weighted graph with non-negative edge weights. Using a min-heap priority queue, the algorithm executes in O((V + E) log V) time.",
            "In Dynamic Programming, the 0/1 Knapsack problem satisfies optimal substructure and overlapping subproblems. Define the state transition recurrence relation dp[i][w] = max(dp[i-1][w], dp[i-1][w-wt[i]] + val[i]) and analyze the pseudo-polynomial complexity.",
            "Explain collision resolution strategies in hash tables, contrasting separate chaining with open addressing techniques including linear probing, quadratic probing, and double hashing. Calculate the expected lookup time under the simple uniform hashing assumption.",
            "Implement a doubly linked list with sentinel head and tail nodes supporting O(1) insertion and deletion operations. Contrast cache locality and pointer overhead between contiguous arrays and dynamic pointer-based node representations.",
            "Kruskal's algorithm finds the Minimum Spanning Tree (MST) of an undirected weighted graph by sorting all edges and greedily adding edges that do not form a cycle, verified efficiently using the Disjoint Set Union (DSU) data structure with path compression.",
            "Breadth-First Search (BFS) traverses graph vertices level by level utilizing a First-In-First-Out (FIFO) queue, proving useful for finding the shortest path in unweighted graphs, bipartite graph verification, and connected component identification.",
        ]
    },
    "Database Management Systems": {
        "educational_level": "college",
        "category": "STEM",
        "topics": [
            "Relational model, Relational Algebra, and Tuple Relational Calculus",
            "SQL queries: JOINs, GROUP BY, subqueries, and window functions",
            "Database design, ER modeling, and functional dependencies",
            "Normalization: 1NF, 2NF, 3NF, and Boyce-Codd Normal Form (BCNF)",
            "ACID properties and Transaction processing states",
            "Concurrency control: Two-Phase Locking (2PL), Timestamp ordering",
            "Database recovery: Write-Ahead Logging (WAL) and Checkpointing",
            "Indexing structures: B-trees, B+ trees, and Hash indexing",
        ],
        "keywords": [
            "database", "dbms", "sql", "relational", "table", "schema", "primary key", "foreign key",
            "entity", "relationship", "er diagram", "normalization", "1nf", "2nf", "3nf", "bcnf",
            "functional dependency", "acid", "atomicity", "consistency", "isolation", "durability",
            "transaction", "concurrency", "locking", "two-phase locking", "deadlock", "serializability",
            "b-tree", "b+ tree", "index", "join", "query optimization", "write-ahead log", "recovery"
        ],
        "templates": [
            "Database normalization eliminates data redundancy and prevents insertion, update, and deletion anomalies. A relation is in Boyce-Codd Normal Form (BCNF) if and only if for every non-trivial functional dependency X -> Y, X is a superkey of the relation.",
            "The ACID properties ensure reliable transaction execution in a DBMS: Atomicity guarantees all-or-nothing completion, Consistency maintains database integrity constraints, Isolation prevents concurrent interference, and Durability ensures committed changes persist.",
            "In relational algebra, fundamental operations include select (sigma), project (pi), Cartesian product (cross), union, and set difference. Construct an algebraic query expression to retrieve student names enrolled in database systems who scored above eighty.",
            "Two-Phase Locking (2PL) is a concurrency control protocol that guarantees conflict serializability of schedules. Transactions acquire locks during the expanding growing phase and release locks during the shrinking phase without acquiring new locks.",
            "B+ trees are self-balancing multiway search tree indices optimized for block-based disk storage systems. All data records are stored exclusively in the leaf nodes linked sequentially for range queries, while internal nodes store routing search keys.",
            "Explain conflict serializability and view serializability of concurrent transaction schedules. Construct a precedence graph (serialization graph) with transactions as vertices and conflicting read-write operations as directed edges to detect cycles.",
            "Write an advanced SQL query utilizing Common Table Expressions (WITH clause) and window functions (ROW_NUMBER, DENSE_RANK, PARTITION BY) to determine the top three highest-earning employees within each departmental division.",
            "Database recovery mechanisms rely on Write-Ahead Logging (WAL) and checkpointing. During system crash recovery, the Aries recovery algorithm executes three passes: the Analysis pass, the Redo pass from the earliest unwritten log record, and the Undo pass.",
        ]
    },
    "Operating Systems": {
        "educational_level": "college",
        "category": "STEM",
        "topics": [
            "Process lifecycle, PCB, context switching, and thread models",
            "CPU scheduling algorithms: FCFS, SJF, Round Robin, and Priority",
            "Process synchronization, Critical Section, Mutex, and Semaphores",
            "Deadlocks: Coffman conditions, Banker's algorithm, and detection",
            "Memory management: Paging, Segmentation, and Translation Lookaside Buffer",
            "Virtual memory, Page faults, and Page replacement algorithms (LRU, FIFO)",
            "File system architecture, inode structure, and directory allocation",
            "Kernel architecture: Monolithic vs Microkernel, System calls, and I/O",
        ],
        "keywords": [
            "operating system", "kernel", "process", "thread", "pcb", "context switch",
            "cpu scheduling", "round robin", "preemptive", "synchronization", "critical section",
            "mutex", "semaphore", "deadlock", "banker's algorithm", "virtual memory", "paging",
            "page table", "tlb", "page fault", "lru", "segmentation", "file system", "inode",
            "system call", "fork", "exec", "ipc", "shared memory", "pipe", "interrupt"
        ],
        "templates": [
            "Process scheduling allocates CPU execution time among ready processes. Compare preemptive Shortest Remaining Time First (SRTF) with Round Robin scheduling under varying time quantum lengths, calculating average turnaround and waiting times.",
            "The Critical Section problem requires mutual exclusion, progress, and bounded waiting. Peterson's algorithm solves two-process synchronization in software, while counting semaphores and mutex locks coordinate multiple concurrent cooperative threads.",
            "Deadlock occurs when processes are unable to proceed because each holds a resource while waiting for another. The four necessary Coffman conditions are mutual exclusion, hold and wait, no preemption, and circular wait. Dijkstra's Banker's algorithm ensures safety.",
            "In virtual memory systems, demand paging maps logical addresses to physical frames via page tables. When a requested page is absent from physical RAM, a page fault exception triggers the OS to fetch the page from backing swap storage.",
            "Analyze page replacement policies including First-In First-Out (FIFO), Optimal Page Replacement (OPT), and Least Recently Used (LRU). Demonstrate Belady's anomaly where increasing allocated page frames increases page fault frequency under FIFO.",
            "The Translation Lookaside Buffer (TLB) is an associative hardware cache storing recently accessed virtual-to-physical address mappings. Calculate the effective memory access time (EMAT) given TLB hit ratio alpha and memory cycle access times.",
            "Unix file systems represent directories and files using inodes containing metadata, access permissions, file size, timestamps, and direct, single indirect, double indirect, and triple indirect data block pointers.",
            "Context switching between processes involves saving the CPU register state into the Process Control Block (PCB) and reloading the saved state of the scheduled process, incurring hardware cache invalidation and TLB flush overhead.",
        ]
    },
    "Computer Networks": {
        "educational_level": "college",
        "category": "STEM",
        "topics": [
            "OSI seven-layer reference model and TCP/IP protocol suite",
            "Physical and Data Link layers: Framing, Error detection (CRC), and CSMA/CD",
            "Network layer: IPv4, IPv6, Subnetting, CIDR, and NAT",
            "Routing protocols: Distance Vector (RIP), Link State (OSPF), and BGP",
            "Transport layer: TCP connection establishment (3-way handshake) and UDP",
            "TCP Flow control (sliding window) and Congestion control (Reno, Cubic)",
            "Application layer protocols: DNS, HTTP/HTTPS, TLS/SSL, SMTP, and DHCP",
            "Network security: Firewalls, packet filtering, symmetric and asymmetric RSA",
        ],
        "keywords": [
            "network", "protocol", "osi", "tcp/ip", "packet", "frame", "router", "switch",
            "ip address", "ipv4", "ipv6", "subnet", "cidr", "nat", "mac address", "arp",
            "routing", "ospf", "bgp", "rip", "tcp", "udp", "handshake", "sliding window",
            "congestion control", "flow control", "dns", "http", "https", "tls", "socket",
            "port", "bandwidth", "latency", "throughput", "firewall", "ethernet"
        ],
        "templates": [
            "The TCP/IP protocol architecture organizes network communications into four layers: Link, Internet, Transport, and Application. Contrast the reliable, connection-oriented byte-stream delivery of TCP with the lightweight, connectionless datagram transport of UDP.",
            "Transmission Control Protocol (TCP) establishes reliable connections via the three-way handshake: SYN, SYN-ACK, and ACK packets. Sequence numbers and acknowledgment fields guarantee in-order delivery and detect dropped segments.",
            "Given an IPv4 block 192.168.10.0/24, perform Classless Inter-Domain Routing (CIDR) subnetting to divide the network into four departmental subnets. Determine the subnet mask, network address, broadcast address, and assignable host range for each.",
            "Compare interior gateway routing protocols: Distance Vector routing (RIP) using Bellman-Ford algorithm suffers from the count-to-infinity problem, whereas Link State routing (OSPF) uses Dijkstra's shortest path algorithm on synchronized topological databases.",
            "TCP congestion control avoids network saturation using four intertwined mechanisms: Slow Start with exponential window growth, Congestion Avoidance with additive increase, Fast Retransmit upon receiving three duplicate ACKs, and Fast Recovery.",
            "The Domain Name System (DNS) is a hierarchical, distributed naming system that translates human-readable domain names into numerical IP addresses through recursive and iterative queries traversing root, TLD, and authoritative nameservers.",
            "Data Link layer error detection frequently employs Cyclic Redundancy Check (CRC). Given data word D and generator polynomial G, perform polynomial binary division using modulo-2 arithmetic to compute the checksum remainder transmitted across frames.",
            "Address Resolution Protocol (ARP) dynamically resolves network layer IPv4 addresses to physical MAC hardware addresses within a local area network broadcast domain, caching mappings in an ARP table with short eviction timers.",
        ]
    },
    "Software Engineering": {
        "educational_level": "college",
        "category": "STEM",
        "topics": [
            "Software Development Life Cycle (SDLC) models: Waterfall, Agile, Spiral",
            "Requirements engineering, Functional/Non-functional, and SRS documentation",
            "Object-oriented design patterns: Creational, Structural, and Behavioral",
            "UML modeling: Class diagrams, Sequence diagrams, and Use case specifications",
            "Software testing: Black-box, White-box, Unit, Integration, and Regression",
            "Software quality metrics, Cyclomatic complexity, and Code refactoring",
            "Version control workflows (Git), branching strategies, and CI/CD automation",
            "DevOps practices, architectural styles: Monolithic vs Microservices",
        ],
        "keywords": [
            "software engineering", "sdlc", "agile", "scrum", "sprint", "waterfall", "kanban",
            "requirements", "srs", "use case", "uml", "class diagram", "sequence diagram",
            "design pattern", "singleton", "factory", "observer", "solid principles", "refactoring",
            "testing", "unit test", "integration test", "regression", "black-box", "white-box",
            "cyclomatic complexity", "git", "ci/cd", "deployment", "microservices", "code review"
        ],
        "templates": [
            "Agile software development emphasizes iterative delivery, customer collaboration, and adaptive planning over rigid documentation. In the Scrum framework, cross-functional teams organize work into fixed-length sprints guided by daily standups and sprint retrospectives.",
            "The SOLID design principles guide robust object-oriented software architecture: Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, and Dependency Inversion ensure modularity and ease maintenance across evolving codebases.",
            "Explain creational and behavioral design patterns in software engineering. The Singleton pattern guarantees a class has only one instance with a global point of access, while the Observer pattern defines a one-to-many dependency for state synchronization.",
            "Software testing verifies system correctness across diverse levels. Black-box testing evaluates functional requirements using equivalence partitioning and boundary value analysis, while white-box testing verifies internal branch coverage and path predicates.",
            "Calculate McCabe's Cyclomatic Complexity for a control flow graph representing a complex algorithm. Cyclomatic complexity V(G) = E - N + 2P indicates the number of linearly independent paths requiring distinct unit test cases.",
            "Unified Modeling Language (UML) class diagrams depict system structural entities, attributes, methods, and relationships including association, aggregation, composition, and inheritance. Sequence diagrams model time-ordered message exchanges between objects.",
            "Continuous Integration and Continuous Deployment (CI/CD) pipelines automate building, linting, unit testing, and production deployment upon code commits to version control repositories, reducing integration friction and time-to-market.",
            "Evaluate architectural trade-offs between monolithic architectures and microservices. Microservices offer independent scalability and fault isolation at the cost of distributed system complexity, network latency, and eventual consistency challenges.",
        ]
    },
    "Machine Learning & AI": {
        "educational_level": "college",
        "category": "STEM",
        "topics": [
            "Supervised vs Unsupervised vs Reinforcement Learning paradigms",
            "Linear regression, Logistic regression, and Cost functions",
            "Loss functions: Mean Squared Error, Binary Cross-Entropy, and Hinge loss",
            "Gradient Descent optimization: Batch, Mini-batch, and Stochastic (SGD)",
            "Decision Trees, Random Forests, and Ensemble Gradient Boosting (XGBoost)",
            "Support Vector Machines (SVM), Kernels, and Margin maximization",
            "Model evaluation: Precision, Recall, F1-score, ROC-AUC, and Confusion Matrix",
            "Neural Networks: Perceptron, Backpropagation, Activation functions (ReLU, Softmax)",
        ],
        "keywords": [
            "machine learning", "artificial intelligence", "supervised", "unsupervised", "regression",
            "classification", "clustering", "gradient descent", "learning rate", "loss function",
            "cross-entropy", "mean squared error", "overfitting", "underfitting", "regularization",
            "l1", "l2", "lasso", "ridge", "decision tree", "random forest", "svm", "kernel",
            "neural network", "deep learning", "backpropagation", "activation function", "relu",
            "precision", "recall", "f1-score", "roc", "auc", "confusion matrix", "pca", "k-means"
        ],
        "templates": [
            "In supervised machine learning, Linear Regression models the linear relationship between independent input features X and a continuous target variable y by minimizing the residual sum of squares cost function using Gradient Descent optimization.",
            "Logistic Regression applies the sigmoid logistic function to compute the posterior probability of a binary class outcome. The model optimizes binary cross-entropy log-loss parameters iteratively via gradient descent updates with learning rate alpha.",
            "Overfitting occurs when a high-capacity machine learning model learns training data noise rather than generalizable underlying patterns. Regularization techniques penalize model complexity by adding L1 Lasso or L2 Ridge norm penalties to the objective function.",
            "Evaluate classification model performance beyond raw accuracy using the confusion matrix. Precision measures the proportion of true positives among predicted positives, Recall measures true positive coverage, and F1-score harmonic mean balances both.",
            "Support Vector Machines (SVM) find the optimal separating hyperplane that maximizes the margin between data points of opposing classes. The kernel trick (RBF, polynomial) maps non-linearly separable inputs into higher-dimensional feature spaces.",
            "Artificial Neural Networks learn hierarchical representations through layers of artificial neurons. During backpropagation, the chain rule computes partial derivatives of the scalar loss with respect to each weight matrix to update weights via optimizer algorithms.",
            "Unsupervised learning algorithms discover inherent patterns in unlabeled data. K-means clustering partitions observations into k distinct clusters by iteratively minimizing the within-cluster sum of squares distance to cluster centroids.",
            "Ensemble methods combine multiple weak learners to build a high-performance predictor. Bagging reduces model variance through bootstrap aggregation in Random Forests, whereas Boosting sequentially trains trees focusing on previously misclassified samples.",
        ]
    },
    "Cloud Computing & DevOps": {
        "educational_level": "college",
        "category": "STEM",
        "topics": [
            "Cloud service models: IaaS, PaaS, SaaS, and Deployment models",
            "Virtualization, Hypervisors (Type 1, Type 2), and Virtual Machines",
            "Containerization: Docker, Images, Containers, and Dockerfiles",
            "Container orchestration: Kubernetes, Pods, Deployments, and Services",
            "Serverless architecture, Function-as-a-Service (FaaS), and Event-driven systems",
            "Cloud storage options: Object storage (S3), Block storage, and File storage",
            "Infrastructure as Code (IaC): Terraform, declarative configuration, and state",
            "DevOps monitoring: Prometheus, Grafana, Log aggregation, and Site Reliability",
        ],
        "keywords": [
            "cloud", "cloud computing", "iaas", "paas", "saas", "aws", "azure", "gcp",
            "virtualization", "hypervisor", "virtual machine", "container", "docker", "dockerfile",
            "kubernetes", "k8s", "pod", "deployment", "cluster", "orchestration", "serverless",
            "lambda", "faas", "microservice", "load balancer", "auto-scaling", "object storage",
            "s3", "iac", "terraform", "devops", "monitoring", "prometheus", "grafana", "ci/cd"
        ],
        "templates": [
            "Cloud computing delivers on-demand computing services over the internet with pay-as-you-go pricing across three primary service models: Infrastructure as a Service (IaaS), Platform as a Service (PaaS), and Software as a Service (SaaS).",
            "Containerization encapsulates application code, dependencies, and system libraries into lightweight, portable Docker container images that share the host operating system kernel, offering superior resource density and startup latency compared to VMs.",
            "Kubernetes is an open-source container orchestration platform designed to automate deploying, scaling, and managing containerized applications. Core primitives include Pods, ReplicaSets, Deployments, Services, and Ingress controllers.",
            "Serverless computing and Function-as-a-Service (FaaS) allow developers to execute event-triggered code without provisioning or managing server infrastructure. Cloud providers dynamically allocate machine resources and scale down to zero when idle.",
            "Infrastructure as Code (IaC) tools like Terraform enable declarative provisioning and lifecycle management of cloud infrastructure. Declarative HCL configuration files define desired cloud topology, tracked reproducibly in version-controlled state files.",
            "High availability cloud architectures employ multi-Availability Zone (AZ) deployments with elastic load balancers distributing incoming network traffic across autoscaling compute instances to maintain uptime and disaster recovery.",
            "Cloud storage architectures distinguish between Object Storage (such as Amazon S3) providing unlimited scalability for unstructured blobs via HTTP REST APIs, and Block Storage providing persistent high-IOPS volumes attached to compute VMs.",
            "Site Reliability Engineering (SRE) implements monitoring and observability across distributed cloud systems using metrics, logs, and distributed traces. Prometheus scrapes time-series metrics while Grafana visualizes Service Level Indicators (SLIs).",
        ]
    },
    "Discrete Mathematics": {
        "educational_level": "college",
        "category": "STEM",
        "topics": [
            "Propositional and Predicate Logic, Truth tables, and Logical equivalence",
            "Set theory, Relations (Equivalence, Partial order), and Functions (Bijection)",
            "Methods of proof: Direct, Contrapositive, Contradiction, and Induction",
            "Combinatorics: Pigeonhole principle, Permutations, Combinations, and Binomial",
            "Graph theory: Eulerian paths, Hamiltonian cycles, Planar graphs, and Trees",
            "Recurrence relations, Generating functions, and Master theorem",
            "Boolean algebra, Logic gates, Karnaugh maps (K-maps), and Minimization",
            "Number theory: Modular arithmetic, Euclidean algorithm, and RSA encryption",
        ],
        "keywords": [
            "discrete math", "logic", "proposition", "predicate", "truth table", "tautology",
            "set theory", "subset", "union", "intersection", "relation", "equivalence relation",
            "partial order", "poset", "function", "bijection", "injection", "surjection",
            "proof", "induction", "contrapositive", "contradiction", "pigeonhole principle",
            "permutation", "combination", "graph theory", "eulerian", "hamiltonian", "planar",
            "recurrence relation", "generating function", "boolean algebra", "k-map", "modular arithmetic"
        ],
        "templates": [
            "In propositional logic, determine whether the compound proposition (p -> q) ^ (q -> r) -> (p -> r) is a tautology using truth tables and algebraic laws of logical equivalence such as De Morgan's laws and material implication.",
            "A binary relation R on a set A is defined as an equivalence relation if and only if it satisfies reflexivity, symmetry, and transitivity. Every equivalence relation partitions the set into disjoint equivalence classes.",
            "Mathematical induction is a fundamental proof technique. To prove a statement P(n) holds for all integers n >= 1, verify the base step P(1) and establish that the inductive hypothesis P(k) implies the truth of P(k+1).",
            "According to the Pigeonhole Principle, if n items are distributed into m containers and n > m, then at least one container must contain more than one item. Apply the generalized pigeonhole principle to prove existence theorems in combinatorics.",
            "In graph theory, an Eulerian path visits every edge of a connected graph exactly once, which exists if and only if the graph has zero or exactly two vertices of odd degree. A Hamiltonian cycle visits every vertex exactly once.",
            "Solve the linear homogeneous recurrence relation with constant coefficients a_n - 5 a_{n-1} + 6 a_{n-2} = 0 subject to initial conditions a_0 = 1 and a_1 = 4 by finding the roots of the characteristic equation.",
            "Boolean algebra defines operations on two-element sets {0, 1}. Simplify the canonical sum-of-products Boolean expression using a 4-variable Karnaugh Map (K-map) by grouping adjacent minterms to derive the minimal sum-of-products form.",
            "The Euclidean algorithm computes the greatest common divisor (GCD) of two integers through successive integer divisions. Extended Euclidean algorithm calculates integers x and y satisfying Bezout's identity a*x + b*y = gcd(a, b).",
        ]
    }
}

def generate_dataset(samples_per_subject=50, output_file="academic_subjects_dataset.csv"):
    """
    Generate synthetic yet authentic academic text samples across 15 subjects.
    Creates variations by combining templates, topic prompts, and keyword enrichment.
    """
    rows = []
    sample_id = 1

    for subject, profile in SUBJECT_PROFILES.items():
        templates = profile["templates"]
        keywords = profile["keywords"]
        topics = profile["topics"]
        level = profile["educational_level"]
        cat = profile["category"]

        # 1. Base template variations
        for template in templates:
            rows.append({
                "id": sample_id,
                "subject": subject,
                "educational_level": level,
                "category": cat,
                "text": template.strip()
            })
            sample_id += 1

        # 2. Topic + keyword synthesis to reach target sample count
        needed = samples_per_subject - len(templates)
        for i in range(needed):
            topic = topics[i % len(topics)]
            selected_kws = random.sample(keywords, min(6, len(keywords)))
            style = i % 4

            if style == 0:
                text = (
                    f"Lecture Notes on {topic} for {subject}. Key concepts and definitions: "
                    f"{', '.join(selected_kws[:3])}. In this chapter, we investigate the fundamental principles "
                    f"governing {topic.lower()}. Students must understand how {selected_kws[0]} relates to "
                    f"{selected_kws[1]} and apply standard analytical techniques to solve practical exercises."
                )
            elif style == 1:
                text = (
                    f"Final Examination Question Paper — {subject} Module on {topic}. "
                    f"Question: Explain in detail the theoretical significance of {selected_kws[0]} and {selected_kws[1]}. "
                    f"Derive the governing mathematical formula or architectural diagram showing how {selected_kws[2]} "
                    f"influences the overall system behavior. Provide an illustrative numerical example or case study."
                )
            elif style == 2:
                text = (
                    f"Textbook Chapter Review: Advanced Studies in {subject}. Section covering {topic}. "
                    f"The study of {topic.lower()} plays a foundational role in academic curricula. "
                    f"Important terminology includes {selected_kws[1]}, {selected_kws[2]}, and {selected_kws[3]}. "
                    f"Experimental observations and mathematical modeling demonstrate that {selected_kws[0]} "
                    f"maintains consistency across standard laboratory conditions and theoretical formulations."
                )
            else:
                text = (
                    f"Academic Course Syllabus and Lab Manual for {subject}: {topic}. "
                    f"Laboratory Experiment Objectives: To verify the properties of {selected_kws[0]} experimentally, "
                    f"measure deviations in {selected_kws[1]}, and calculate error bounds using {selected_kws[2]}. "
                    f"Prerequisites include fundamental knowledge of {topic.lower()} and related core coursework."
                )

            rows.append({
                "id": sample_id,
                "subject": subject,
                "educational_level": level,
                "category": cat,
                "text": text.strip()
            })
            sample_id += 1

    df = pd.DataFrame(rows)
    # Shuffle dataset for clean train/test splits
    df = df.sample(frac=1, random_state=42).reset_index(drop=True)
    df["id"] = range(1, len(df) + 1)

    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    df.to_csv(output_file, index=False)
    print(f"Generated {len(df)} samples across {len(SUBJECT_PROFILES)} subjects.")
    print(f"Saved to: {output_file}")
    return df

if __name__ == "__main__":
    out_path = os.path.join(os.path.dirname(__file__), "academic_subjects_dataset.csv")
    generate_dataset(samples_per_subject=50, output_file=out_path)
