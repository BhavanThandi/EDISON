// The TL072 and 7-segment guides, recipes and examples exactly as they were
// BEFORE the board mirror (commit 8fa7ac8: row a at the top of the screen, a30 …),
// captured as data. test/recipe-handedness.test.js reflects them by Ruling 21
// (a local column reflection) and compares the current recipes with the result.
// Do not edit: it is the original, not a spec to keep in step with the app.

module.exports = {
  "tl072": {
    "guide": "Pins 1 OUT1, 2 IN1−, 3 IN1+, 4 V−, 5 IN2+, 6 IN2−, 7 OUT2, 8 V+; hole=fC, right: 1-4 fC..fC+3, 8-5 eC..eC+3. One place_bench_supply PS1; ±12: V+ tp, V− bn. FG1 place_function_generator, COM tn; sine: amplitude=peak V, freq, offset 0; DC: offset, amp 0. Inverting −Rf/Rin; divider→Rin: stiff, R ≤ Rin/10. Follower: FG1.0→IN1+, OUT1→IN1−. Comparator: V− tn, divider→IN1−, OUT1→place_resistor→place_led.",
    "recipe": {
      "name": "inverting amplifier, gain −10, on ±12 V: FG1 (a 0.5 V sine) through Rin 10 kΩ into IN1− (pin 2), Rf 100 kΩ from IN1− to OUT1 (pin 1), IN1+ (pin 3) to COM: OUT1 ≈ −5 V at the peak",
      "parts": [
        {
          "type": "bench_supply",
          "label": "PS1",
          "values": {
            "voltage": 12
          }
        },
        {
          "type": "function_generator",
          "label": "FG1",
          "values": {
            "amplitude": 0.5,
            "offset": 0,
            "frequency": 1
          }
        },
        {
          "type": "tl072",
          "label": "U1",
          "holes": [
            "f30",
            "f31",
            "f32",
            "f33",
            "e33",
            "e32",
            "e31",
            "e30"
          ]
        },
        {
          "type": "resistor",
          "label": "R1",
          "holes": [
            "g27",
            "g31"
          ],
          "values": {
            "resistance": 10000
          }
        },
        {
          "type": "resistor",
          "label": "R2",
          "holes": [
            "h31",
            "h35"
          ],
          "values": {
            "resistance": 100000
          }
        }
      ],
      "wires": [
        [
          "PS1.0",
          "tp_63"
        ],
        [
          "PS1.1",
          "tn_63"
        ],
        [
          "PS1.3",
          "tn_62"
        ],
        [
          "PS1.2",
          "bn_63"
        ],
        [
          "FG1.1",
          "tn_61"
        ],
        [
          "tp_30",
          "a30"
        ],
        [
          "bn_33",
          "j33"
        ],
        [
          "FG1.0",
          "h27"
        ],
        [
          "i35",
          "i30"
        ],
        [
          "j32",
          "tn_32"
        ]
      ],
      "expect": {
        "U1": {
          "vout1": [
            -0.01,
            0.01
          ],
          "mode1": "linear",
          "unused2": true
        }
      }
    },
    "recipes": [
      {
        "name": "voltage follower on ±12 V: FG1 (offset 3 V) into IN1+ (pin 3), OUT1 (pin 1) wired to IN1− (pin 2): OUT1 = 3 V",
        "parts": [
          {
            "type": "bench_supply",
            "label": "PS1",
            "values": {
              "voltage": 12
            }
          },
          {
            "type": "function_generator",
            "label": "FG1",
            "values": {
              "amplitude": 0,
              "offset": 3,
              "frequency": 1
            }
          },
          {
            "type": "tl072",
            "label": "U1",
            "holes": [
              "f30",
              "f31",
              "f32",
              "f33",
              "e33",
              "e32",
              "e31",
              "e30"
            ]
          }
        ],
        "wires": [
          [
            "PS1.0",
            "tp_63"
          ],
          [
            "PS1.1",
            "tn_63"
          ],
          [
            "PS1.3",
            "tn_62"
          ],
          [
            "PS1.2",
            "bn_63"
          ],
          [
            "FG1.1",
            "tn_61"
          ],
          [
            "tp_30",
            "a30"
          ],
          [
            "bn_33",
            "j33"
          ],
          [
            "FG1.0",
            "j32"
          ],
          [
            "g30",
            "g31"
          ]
        ],
        "expect": {
          "U1": {
            "vout1": [
              2.99,
              3.01
            ],
            "mode1": "linear",
            "unused2": true
          }
        }
      },
      {
        "name": "comparator on one 12 V supply (V− pin 4 on COM): FG1 (offset 6 V) into IN1+ (pin 3), a 7k/5k divider sets IN1− (pin 2) to 5 V, OUT1 (pin 1) through 1 kΩ to a red LED to COM: lit above 5 V",
        "parts": [
          {
            "type": "bench_supply",
            "label": "PS1",
            "values": {
              "voltage": 12
            }
          },
          {
            "type": "function_generator",
            "label": "FG1",
            "values": {
              "amplitude": 0,
              "offset": 6,
              "frequency": 1
            }
          },
          {
            "type": "tl072",
            "label": "U1",
            "holes": [
              "f30",
              "f31",
              "f32",
              "f33",
              "e33",
              "e32",
              "e31",
              "e30"
            ]
          },
          {
            "type": "resistor",
            "label": "R1",
            "holes": [
              "b41",
              "b45"
            ],
            "values": {
              "resistance": 7000
            }
          },
          {
            "type": "resistor",
            "label": "R2",
            "holes": [
              "c37",
              "c41"
            ],
            "values": {
              "resistance": 5000
            }
          },
          {
            "type": "resistor",
            "label": "R3",
            "holes": [
              "h26",
              "h30"
            ],
            "values": {
              "resistance": 1000
            }
          },
          {
            "type": "led",
            "label": "LED1",
            "holes": [
              "i24",
              "i26"
            ],
            "values": {
              "color": "red"
            }
          }
        ],
        "wires": [
          [
            "PS1.0",
            "tp_63"
          ],
          [
            "PS1.1",
            "tn_63"
          ],
          [
            "FG1.1",
            "tn_61"
          ],
          [
            "tp_30",
            "a30"
          ],
          [
            "j33",
            "tn_33"
          ],
          [
            "tp_45",
            "a45"
          ],
          [
            "a37",
            "tn_37"
          ],
          [
            "d41",
            "g31"
          ],
          [
            "FG1.0",
            "j32"
          ],
          [
            "j24",
            "tn_24"
          ]
        ],
        "expect": {
          "U1": {
            "mode1": "high"
          },
          "LED1": {
            "on": true,
            "current": [
              7.9,
              8.3
            ]
          }
        }
      }
    ],
    "examples": [
      {
        "name": "a follower of 6 V on the bench supply at ±12 V: OUT1 at 6 V, linear",
        "parts": [
          {
            "type": "bench_supply",
            "label": "PS1",
            "values": {
              "voltage": 12
            }
          },
          {
            "type": "tl072",
            "label": "U1",
            "holes": [
              "f30",
              "f31",
              "f32",
              "f33",
              "e33",
              "e32",
              "e31",
              "e30"
            ]
          },
          {
            "type": "resistor",
            "label": "R1",
            "holes": [
              "a40",
              "a45"
            ],
            "values": {
              "resistance": 1000
            }
          },
          {
            "type": "resistor",
            "label": "R2",
            "holes": [
              "b40",
              "b35"
            ],
            "values": {
              "resistance": 1000
            }
          }
        ],
        "wires": [
          [
            "PS1.0",
            "tp_1"
          ],
          [
            "PS1.1",
            "tn_1"
          ],
          [
            "PS1.2",
            "bn_1"
          ],
          [
            "tp_30",
            "a30"
          ],
          [
            "bn_33",
            "j33"
          ],
          [
            "tp_45",
            "c45"
          ],
          [
            "c35",
            "tn_35"
          ],
          [
            "d40",
            "j32"
          ],
          [
            "g30",
            "g31"
          ],
          [
            "a33",
            "tn_33"
          ],
          [
            "b32",
            "b31"
          ]
        ],
        "expect": {
          "U1": {
            "vout1": [
              5.99,
              6.01
            ],
            "mode1": "linear",
            "vout2": [
              -0.01,
              0.01
            ],
            "mode2": "linear"
          }
        }
      }
    ]
  },
  "seven_segment": {
    "guide": "Each segment needs its own resistor (place_resistor); common pins go to ground. At hole f30, direction right, each pin sits in: e=f30 d=f31 com1=f32 c=f33 dp=f34 (bottom half, feed from rows g–j) and g=e30 f=e31 com2=e32 a=e33 b=e34 (top half, feed from rows a–d). Feed each lit segment from + through its own 470 Ω into its column. Wire a32 (com2) to tn. 1 = b c; 7 = a b c; 8 = all seven.",
    "recipe": {
      "name": "a, b and c each through their own 470 Ω from 9 V, com2 to ground: it shows '7'",
      "parts": [
        {
          "type": "battery",
          "label": "BAT1"
        },
        {
          "type": "seven_segment",
          "label": "DS1",
          "holes": [
            "f30",
            "f31",
            "f32",
            "f33",
            "f34",
            "e34",
            "e33",
            "e32",
            "e31",
            "e30"
          ]
        },
        {
          "type": "resistor",
          "label": "R1",
          "holes": [
            "b33",
            "b37"
          ],
          "values": {
            "resistance": 470
          }
        },
        {
          "type": "resistor",
          "label": "R2",
          "holes": [
            "c34",
            "c39"
          ],
          "values": {
            "resistance": 470
          }
        },
        {
          "type": "resistor",
          "label": "R3",
          "holes": [
            "h33",
            "h37"
          ],
          "values": {
            "resistance": 470
          }
        }
      ],
      "wires": [
        [
          "BAT1.0",
          "tp_63"
        ],
        [
          "BAT1.1",
          "tn_63"
        ],
        [
          "tp_37",
          "a37"
        ],
        [
          "tp_39",
          "a39"
        ],
        [
          "e37",
          "f37"
        ],
        [
          "a32",
          "tn_32"
        ]
      ],
      "expect": {
        "DS1": {
          "digit": "7",
          "segments": "abc",
          "dp": false
        }
      }
    },
    "recipes": [],
    "examples": [
      {
        "name": "b and c each through 470 Ω from 9 V, commons to ground: it shows '1'",
        "parts": [
          {
            "type": "battery",
            "label": "BAT1"
          },
          {
            "type": "seven_segment",
            "label": "DS1",
            "holes": [
              "f30",
              "f31",
              "f32",
              "f33",
              "f34",
              "e34",
              "e33",
              "e32",
              "e31",
              "e30"
            ]
          },
          {
            "type": "resistor",
            "label": "R1",
            "holes": [
              "c34",
              "c39"
            ]
          },
          {
            "type": "resistor",
            "label": "R2",
            "holes": [
              "h33",
              "h37"
            ]
          }
        ],
        "wires": [
          [
            "BAT1.0",
            "tp_63"
          ],
          [
            "BAT1.1",
            "tn_63"
          ],
          [
            "tp_1",
            "bp_1"
          ],
          [
            "tn_1",
            "bn_1"
          ],
          [
            "tp_39",
            "a39"
          ],
          [
            "bp_37",
            "j37"
          ],
          [
            "a32",
            "tn_32"
          ],
          [
            "j32",
            "bn_32"
          ]
        ],
        "expect": {
          "DS1": {
            "digit": "1",
            "segments": "bc",
            "dp": false
          }
        }
      }
    ]
  }
};
