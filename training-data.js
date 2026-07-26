(()=>{
  const CIRCUITS={
    base:[
      '10 bodyweight squats',
      '6–10 push-ups (knees or hands-elevated if needed)',
      '20 jumping jacks (or step jacks)',
      '20-second plank'
    ],
    legsCore:[
      '10 reverse lunges total',
      '12 glute bridges',
      '15 calf raises',
      '20-second side plank each side'
    ],
    run:[
      '12 bodyweight squats',
      '8–12 push-ups',
      '20 mountain climbers total',
      '25-second plank'
    ],
    strong:[
      '15 bodyweight squats',
      '10–15 push-ups',
      '30 jumping jacks (or step jacks)',
      '12 reverse lunges total',
      '30-second plank'
    ],
    core:[
      '10 bird dogs each side',
      '10 dead bugs each side',
      '15 glute bridges',
      '25-second plank'
    ],
    ride:[
      '12 bodyweight squats',
      '10 reverse lunges total',
      '8–12 push-ups',
      '20-second plank'
    ],
    swimDeck:[
      '12 bodyweight squats',
      '8–12 push-ups',
      '15 calf raises',
      '20-second plank'
    ]
  };

  const S=(title,cardio,circuit=null,rounds=0,when='',note='')=>({
    title,cardio,
    workout:circuit?{rounds,moves:CIRCUITS[circuit]}:null,
    when,note
  });

  const walkStop='Do the circuit at a safe halfway point or after the walk.';
  const runStop='Pause in a safe area off the roadway/trail, then resume your run after the circuit.';
  const rideStop='Dismount completely and move well off the road/trail before doing the circuit.';
  const finish='Do the circuit after the cardio while you are still warm.';
  const poolSafe='Do deck exercises only on a dry, non-slip area. Skip deck work if the surface is slick.';

  const walkStart=[20,25,30,35].map((m,w)=>[
    S('Easy walk + full body',`${m} min easy walk`,'base',w<2?2:3,walkStop),
    S('Brisk walk + legs/core',`${m} min brisk walk`,'legsCore',2,finish),
    S('Walk intervals',`${m+5} min total: alternate 3 min comfortable / 1 min brisk`,'base',2,walkStop),
    S('Long easy walk',`${m+10} min comfortable walk`,'core',2,finish)
  ]);

  const walk5k=[30,35,40,45,50,55].map((m,w)=>[
    S('Steady walk + strength',`${m} min steady walk`,'base',w<2?2:3,walkStop),
    S('Brisk intervals',`${Math.max(25,m-5)} min: 4 min brisk / 2 min easy`,'legsCore',2,finish),
    S('Power walk + full body',`${m} min purposeful walk`,'strong',w<3?2:3,walkStop),
    S(w===5?'5K walk':'Long walk',w===5?'Complete a 5K walk at a sustainable pace':`${m+10} min easy-to-steady walk`,w===5?null:'core',w===5?0:2,finish)
  ]);

  const runIntervals=[
    '20 min: 1 min run / 2 min walk','22 min: 2 run / 2 walk','25 min: 3 run / 2 walk','28 min: 5 run / 2 walk',
    '30 min: 8 run / 2 walk','32 min: 10 run / 1 walk','30 min continuous easy run','5K run/walk at a sustainable pace'
  ];
  const run5k=runIntervals.map((cardio,w)=>[
    S('Run/walk + full body',cardio,'base',w<3?2:3,runStop),
    S('Easy aerobic + core',`${24+w*2} min easy walk/jog`,'core',2,finish),
    S(w===7?'5K day':'Long run/walk',w===7?runIntervals[w]:`${28+w*2} min comfortable run/walk`,w===7?null:'run',w===7?0:2,finish)
  ]);

  const run10k=[35,40,45,45,50,50,55,40].map((m,w)=>[
    S('Easy run + strength',`${m} min easy conversational run`,'run',w<3?2:3,finish),
    S('Quality run',`${30+Math.min(w,5)*3} min total with ${4+Math.min(w,4)} × 1 min strong / 2 min easy`,'core',2,finish),
    S('Recovery run + bodyweight',`${30+Math.min(w,5)*2} min relaxed run`,'base',2,runStop),
    S(w===7?'10K effort':'Long run',w===7?'Complete a 10K at a controlled effort':`${50+w*5} min comfortable long run`,w===7?null:'legsCore',w===7?0:2,finish)
  ]);

  const rideStart=[25,30,35,40,45,50].map((m,w)=>[
    S('Easy ride + bodyweight',`${m} min easy ride`,'ride',2,rideStop),
    S('Cadence ride + core',`${m} min ride with 6 × 30 sec quick cadence / 90 sec easy`,'core',2,rideStop),
    S('Long ride',`${m+20} min comfortable ride`,'base',w<3?2:3,rideStop)
  ]);

  const rideEndurance=[45,50,55,60,65,70,75,60].map((m,w)=>[
    S('Steady ride + strength',`${m} min steady ride`,'ride',w<3?2:3,rideStop),
    S('Bike intervals',`${40+Math.min(w,5)*5} min total with 6 × 2 min strong / 3 min easy`,'core',2,rideStop),
    S('Long endurance ride',`${70+w*10} min comfortable endurance ride`,'base',2,rideStop)
  ]);

  const bodyweightBase=[2,2,3,3].map((rounds,w)=>[
    S('Full-body circuit','Optional warm-up: 10–20 min easy walk, jog, or ride','base',rounds,finish,'Move smoothly; stop 1–2 reps before form breaks.'),
    S('Legs + core','Optional: 15–25 min easy walk','legsCore',rounds,finish),
    S('Cardio-bodyweight mix',`${20+w*5} min walk/jog. Every 5 min, stop safely for the circuit.`,'base',rounds,walkStop)
  ]);

  const cardioStrength=[2,2,3,3,3,2].map((rounds,w)=>[
    S('Walk/run + circuit',`${30+w*3} min easy-to-steady walk/run`,'strong',rounds,walkStop),
    S('Easy cardio + core',`${30+w*4} min easy walk, run, or ride`,'core',2,finish),
    S('Bodyweight conditioning','5 min easy walk, then circuit, then 10 min easy cardio','base',rounds,finish,'Rest 30–60 seconds between rounds as needed.'),
    S('Long easy cardio',`${40+w*5} min choice of walk, run, or ride`,'legsCore',2,finish)
  ]);

  const swimStart=[6,8,10,12,14,16].map((lengths,w)=>[
    S('Easy pool swim',`Warm up 2 easy lengths. Then ${lengths} easy lengths with 20–40 sec rest as needed. Cool down 2 easy lengths.`,'swimDeck',2,finish,poolSafe),
    S('Swim intervals',`2 easy lengths, then ${Math.max(4,Math.floor(lengths/2))} × 1 length moderate / 1 length easy, then 2 easy lengths.`,'core',2,finish,poolSafe),
    S('Continuous pool day',`Swim ${lengths+4} total lengths at an easy pace. Rest at the wall whenever needed.`,'swimDeck',w<3?2:3,finish,poolSafe)
  ]);

  const swimFitness=[12,14,16,18,20,22].map((lengths,w)=>[
    S('Steady swim + deck strength',`4 easy lengths, ${lengths} steady lengths, 2 easy lengths.`,'swimDeck',3,finish,poolSafe),
    S('Pool intervals',`4 easy lengths, then ${6+w} × 2 lengths strong / 1 length easy, then 2 easy lengths.`,'core',2,finish,poolSafe),
    S('Endurance swim',`${lengths+10} total lengths easy-to-steady. Break into sets of 4–8 lengths if needed.`,'swimDeck',2,finish,poolSafe)
  ]);

  window.STRIDE_TRAINING_PLANS=[
    {id:'walk-start-4',category:'walk',icon:'🚶',title:'Start Walking + Bodyweight',level:'Beginner',weeks:4,days:4,desc:'Build a walking habit while adding short no-equipment strength circuits.',schedule:walkStart},
    {id:'walk-5k-6',category:'walk',icon:'🚶',title:'Walk a 5K + Strength',level:'Beginner',weeks:6,days:4,desc:'Progress toward a 5K with bodyweight work built into the week.',schedule:walk5k},
    {id:'run-5k-8',category:'run',icon:'🏃',title:'Run / Walk to 5K + Bodyweight',level:'Beginner',weeks:8,days:3,desc:'Run/walk progression plus short circuits for full-body strength.',schedule:run5k},
    {id:'run-10k-8',category:'run',icon:'🏃',title:'Build to 10K + Strength',level:'Intermediate',weeks:8,days:4,desc:'Build running endurance while keeping two or three short bodyweight circuits each week.',schedule:run10k},
    {id:'ride-start-6',category:'ride',icon:'🚲',title:'Start Riding + Bodyweight',level:'Beginner',weeks:6,days:3,desc:'Ride for fitness and add safe off-bike bodyweight circuits.',schedule:rideStart},
    {id:'ride-endurance-8',category:'ride',icon:'🚲',title:'Ride Endurance + Strength',level:'Intermediate',weeks:8,days:3,desc:'Longer rides, bike intervals, and short off-bike strength work.',schedule:rideEndurance},
    {id:'workout-base-4',category:'workout',icon:'💪',title:'Bodyweight Base',level:'Beginner',weeks:4,days:3,desc:'Actual no-equipment workouts using squats, push-ups, jacks, lunges, bridges, and planks.',schedule:bodyweightBase},
    {id:'workout-cardio-6',category:'workout',icon:'⚡',title:'Cardio + Bodyweight',level:'Intermediate',weeks:6,days:4,desc:'Combine walking, running, or riding with progressive bodyweight circuits.',schedule:cardioStrength},
    {id:'swim-start-6',category:'swim',icon:'🏊',title:'Pool Swim Starter + Deck Strength',level:'Beginner',weeks:6,days:3,desc:'A pool-length progression with simple bodyweight work afterward.',schedule:swimStart},
    {id:'swim-fitness-6',category:'swim',icon:'🏊',title:'Swim Fitness + Bodyweight',level:'Intermediate',weeks:6,days:3,desc:'Steady swimming, intervals, endurance, and dry-deck strength.',schedule:swimFitness}
  ];

  window.STRIDE_EXERCISE_LIBRARY=[
    {name:'Bodyweight squat',cue:'Feet comfortable-width, sit hips back and down, stand tall.',easier:'Use a shallower range of motion.'},
    {name:'Push-up',cue:'Keep a straight line from shoulders to hips; lower under control.',easier:'Use knees or place hands on a sturdy wall/bench.'},
    {name:'Jumping jack',cue:'Land softly and keep knees relaxed.',easier:'Step one foot out at a time instead of jumping.'},
    {name:'Reverse lunge',cue:'Step backward, lower under control, then drive through the front foot.',easier:'Use a smaller step and shallower depth.'},
    {name:'Plank',cue:'Brace your stomach and squeeze glutes without letting hips sag.',easier:'Use knees or shorten the hold.'},
    {name:'Mountain climber',cue:'Hands under shoulders; bring knees forward without bouncing your hips.',easier:'Move slowly one leg at a time.'},
    {name:'Glute bridge',cue:'Drive through feet and squeeze glutes at the top.',easier:'Reduce range of motion.'},
    {name:'Bird dog',cue:'From hands and knees, reach opposite arm and leg while keeping hips square.',easier:'Move only one limb at a time.'},
    {name:'Dead bug',cue:'Keep lower back gently against the ground while extending opposite arm and leg.',easier:'Move only the legs or only the arms.'},
    {name:'Calf raise',cue:'Rise onto the balls of your feet, pause, then lower slowly.',easier:'Use a wall lightly for balance.'}
  ];
})();