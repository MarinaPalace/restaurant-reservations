/**
 * The master copy. Every other language is a partial of this, merged over it
 * key by key, so anything left untranslated appears here in English rather than
 * as a blank or a key name.
 *
 * Rules for adding to it:
 *
 * - Plain strings only. `{placeholders}` are filled by `format`, and counted
 *   nouns go through `plural`, which needs one/few/many/other rather than a
 *   ternary — Russian and Polish have three forms and Romanian has three.
 * - Write for a guest who has just arrived at a hotel, in the voice of the
 *   dining room: courteous, short, and never technical.
 * - Staff screens are not in here. `/admin` stays in English.
 */
export const en = {
  common: {
    continue: "Continue",
    back: "Back",
    cancel: "Cancel",
    close: "Close",
    saving: "Saving…",
    checking: "Checking…",
    loading: "Loading…",
    room: "Room",
    guests: "Guests",
    date: "Date",
    menu: "Menu",
    skipToContent: "Skip to main content",
    language: "Language",
    theme: {
      label: "Colour theme",
      light: "Light",
      dark: "Dark",
      auto: "Auto",
    },
    vegan: "Vegan",
    allergens: "Allergens",
    ingredients: "Ingredients",
    guestNumber: "Guest {number}",
    guestCount: {
      one: "{count} guest",
      few: "{count} guests",
      many: "{count} guests",
      other: "{count} guests",
    },
    /** The noun alone, for places where the number is already on screen. */
    guestWord: {
      one: "guest",
      few: "guests",
      many: "guests",
      other: "guests",
    },
    connectionProblem: "We could not reach the restaurant. Please check your connection and try again.",
  },

  steps: {
    label: "Booking progress",
    stepOf: "Step {current} of {total}: {name}",
    room: "Your stay",
    guests: "Guests",
    date: "Date",
    menu: "Menu",
    summary: "Confirm",
  },

  entry: {
    eyebrow: "Reservations",
    titleLine1: "Reserve",
    titleLine2: "your dinner",
    intro: "Dinner is part of your stay. Your pass-key is on the card you were given — scan it, or type it below.",
    passKeyLabel: "Pass-key",
    passKeyHint: "From your card. Capitals and dashes do not matter.",
    passKeyMissing: "Please enter the pass-key from your card.",
    passKeyInvalid: "That pass-key is not valid. Please check it and try again.",
    checkKey: "Check my pass-key",
    accepted: "Pass-key accepted.",
    acceptedUntil: "Pass-key accepted, valid up to {date}.",
    acceptedDinners: {
      one: "Pass-key accepted. One dinner left on it.",
      few: "Pass-key accepted. {count} dinners left on it.",
      many: "Pass-key accepted. {count} dinners left on it.",
      other: "Pass-key accepted. {count} dinners left on it.",
    },
    acceptedDinnersUntil: {
      one: "Pass-key accepted. One dinner left on it, up to {date}.",
      few: "Pass-key accepted. {count} dinners left on it, up to {date}.",
      many: "Pass-key accepted. {count} dinners left on it, up to {date}.",
      other: "Pass-key accepted. {count} dinners left on it, up to {date}.",
    },
    useAnotherKey: "Use a different pass-key",
    roomLabel: "Your room number",
    roomHint: "The room you are in now — tell us if you have moved since checking in.",
    roomPlaceholder: "e.g. 402 or L10",
    roomInvalid: "Please enter your room number, for example 402 or L10.",
    alreadyBooked: "You already have a reservation on {dates}.",
    alreadyBookedManage: "To change it, {link} instead. Carry on only if you are booking a second table.",
    alreadyBookedLink: "manage your reservation",
    manageQuestion: "Already booked?",
    manageLink: "Change or cancel your reservation",
    noKey: "No pass-key, or it is not working? Dial {number} from your room to reach guest services.",
  },

  guests: {
    title: "How many guests?",
    description: "Every guest chooses their own menu on the next step.",
    roomEyebrow: "Room {room}",
    legend: "Number of guests",
    choose: "Please choose how many guests will be dining.",
    tooMany: {
      one: "This pass-key is for one guest.",
      few: "This pass-key is for up to {count} guests.",
      many: "This pass-key is for up to {count} guests.",
      other: "This pass-key is for up to {count} guests.",
    },
    bookingIsFor: "Your booking with us is for {guests}, so dinner can be booked for up to that many. Fewer is no trouble — speak to reception if your party has grown.",
  },

  dateStep: {
    title: "Select a dinner date",
    description: "Showing evenings with room for {guests}.",
    calendarLabel: "Dinner dates",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    chooseAvailable: "Please choose an available date.",
    noDates: "No dinner dates are open for reservations yet. Please contact guest services.",
    alreadyBooked:
      "You already have a reservation on this evening. To change it, {link} instead — carry on only if you are booking a second table, for another room.",
    keyExpires:
      "Your pass-key books dinner up to {date}, the day you check out. Evenings after that are not available.",
    seatedAt: "Everyone is seated at {time}. Please arrive on time.",
    notOpen: "This date is not open for reservations.",
    closed: "The restaurant is closed on this date.",
    full: "Fully booked — please choose another evening.",
    notEnoughSeats: "Only {count} seats remain, and you need {guests}.",
    seatsRemaining: "{count} seats remaining.",
    selectToContinue: "Select a date to continue.",
    /** Spoken by the calendar, and shown under each day. */
    day: {
      past: "in the past",
      notOpen: "not open for reservations",
      closed: "restaurant closed",
      closedHint: "Closed",
      full: "fully booked",
      fullHint: "Full",
      leftHint: "{count} left",
      notEnough: "only {count} seats left, not enough for {guests} guests",
      afterStay: "after your stay ends",
      afterStayHint: "After your stay",
      available: "{count} seats available",
    },
  },

  menuStep: {
    title: "Choose your menu",
    description: "Each guest picks one option per course.",
    guest: "Guest",
    completeCount: "{done} of {total} complete",
    complete: "complete",
    incomplete: "incomplete",
    notPublished: "The menu is not published yet. Please contact guest services.",
    choicesForGuest: "Choices for guest {number}",
    allChosen: "All courses chosen for this guest.",
    coursesChosen: "{done} of {total} courses chosen",
    courseNumber: "Course {number}",
    required: "Required",
    optional: "Optional",
    optionsForGuest: "{course} options for guest {number}",
    courseOptions: "{course} options",
    noThankYou: "No thank you",
    skipCourse: "Skip this course",
    chooseCourse: "Choose {course}",
    continueToGuest: "Continue to guest {number}",
    review: "Review reservation",
    backToDate: "Back to the date",
    everyoneChosen: "Everyone has chosen.",
    guestsFinished: "{done} of {total} guests have finished choosing.",
  },

  summary: {
    eyebrow: "Your table",
    title: "Review your reservation",
    noChoices: "No menu choices selected yet.",
    notesLabel: "Allergies or requests",
    notesHint: "Anything the kitchen should know. Optional.",
    notesPlaceholder: "e.g. one guest is allergic to nuts",
    shareTable: "We are dining with another room",
    joinLabel: "Their reservation number",
    joinHint: "Ask them for the number on their confirmation, e.g. VDM-3E94B8.",
    joinPlaceholder: "e.g. VDM-3E94B8",
    confirm: "Confirm reservation",
    confirming: "Confirming…",
    failed: "Something went wrong while creating your reservation. Please try again.",
  },

  appError: {
    title: "Something went wrong",
    description:
      "We could not load this page just now. Please try again in a moment, or contact guest services if it keeps happening.",
    reference: "Reference",
    tryAgain: "Try again",
    startOver: "Start over",
  },

  premium: {
    invitationEyebrow: "An invitation",
    invitationTitle: "Reserve your evening",
    invitationDescription:
      "Please choose your evening and your menu. We keep your choices for the kitchen, so everything is ready when you arrive.",
    partyEyebrow: "Your party",
    partyTitle: "Who is coming",
    keyLabel: "Pass-key from your invitation",
    keyMissing: "Please enter the pass-key from your invitation.",
    nameLabel: "Name the reservation is under",
    namePlaceholder: "e.g. Maria Petrova",
    nameMissing: "Please tell us who the reservation is for.",
    dateMissing: "Please choose one of the evenings offered.",
    evening: "Evening",
    dateTitle: "Choose your date",
    dateDescription: "Only the evenings held for this invitation can be selected.",
    calendarLabel: "Evenings held for you",
    seatedAt: "Everyone is seated at {time}. Please arrive a few minutes early.",
    placesRemaining: "{count} places remaining.",
    selectEvening: "Select one of the highlighted evenings.",
    menuTitle: "Choose your dishes",
    menuNotPublished: "The menu for this evening is not published yet. Please come back shortly.",
    confirm: "Confirm my reservation",
    expectedEyebrow: "You are expected",
    confirmedTitle: "Reservation confirmed",
    confirmedThanks: "Thank you, {name}. We look forward to welcoming you.",
    addToCalendar: "Add to Google Calendar",
    noEveningsTitle: "No evenings are open just yet",
    noEveningsDescription:
      "This invitation has no dates available at the moment. Please try again shortly, or contact the hotel.",
  },

  manage: {
    eyebrow: "Your reservation",
    title: "Manage your reservation",
    description: "Enter the pass-key you booked with — the one from your check-in slip.",
    keyHint: "Capitals and dashes do not matter.",
    keyFormat: "Please enter the pass-key exactly as it appears on your slip.",
    notFound: "We could not find a reservation for that pass-key. Please check it and try again.",
    find: "Find my reservation",
    lookingUp: "Looking up…",
    bookedAtReception:
      "Booked at reception rather than online, or lost your slip? Dial {number} from your room and they will change it for you.",
    listEyebrow: "Your reservations",
    listTitle: "You have more than one dinner booked",
    listChoose: "Choose the one you want to change.",
    dinnersLeft: {
      one: "Your pass-key can still book one more.",
      few: "Your pass-key can still book {count} more.",
      many: "Your pass-key can still book {count} more.",
      other: "Your pass-key can still book {count} more.",
    },
    bookAnother: "Book another evening",
    reservationNumber: "Reservation {number}",
    roomLine: "Room {room} · {guests}",
    arrival: "arrival {time}",
    confirmedLabel: "confirmed",
    cancelledLabel: "cancelled",
    closed: "Changes close twelve hours before dinner. Please dial 9 and reception will help.",
    untilDeadline: "You can change or cancel this booking yourself until {deadline}.",
    changingFor: "Changing choices for",
    discard: "Discard changes",
    saveChoices: "Save choices",
    saved: "Your menu choices have been updated.",
    saveFailed: "We could not save your changes.",
    changeChoices: "Change menu choices",
    cancelReservation: "Cancel reservation",
    cancelFailed: "We could not cancel this reservation.",
    cancelConfirm:
      "Cancel reservation {number}? Your pass-key will work again afterwards, so you can book another evening. If you cancel by mistake, reception can put it back.",
    cancelled:
      "Your reservation has been cancelled. Your pass-key works again, so you can book another evening — or call reception if this was a mistake.",
    backToRestaurant: "Back to the restaurant",
  },

  confirmation: {
    title: "Your table is booked",
    description: "We look forward to welcoming you. Please arrive a few minutes early.",
    number: "Reservation number",
    arrivalTime: "Arrival time",
    contactOn: "We will contact you on",
    viaApp: "via {app}",
    sharedTable: "You are seated with the other rooms in booking {number}.",
    shareInvite:
      "Dining with another room? Give them your reservation number and they can ask to share your table.",
    addReminder: "Add a reminder",
    googleCalendar: "Google Calendar",
    otherCalendar: "Apple or Outlook",
    newTab: "(opens in a new tab)",
    print: "Print",
    changeOrCancel: "Change or cancel",
    keepKey: "Keep your pass-key — it is what you use to change or cancel this booking.",
    missingTitle: "No reservation found",
    missingDescription: "This confirmation is only available in the browser tab where the booking was made.",
    startAgain: "Start a new reservation",
  },

  /**
   * Promotions, offered once, on the confirmation screen.
   *
   * The wording carries the one thing the guest has to understand: this screen
   * is the only place these are offered. Say it plainly rather than dressing it
   * up — a guest who assumes they can add the wine later, and cannot, has been
   * misled by the copy rather than by the rule.
   */
  promo: {
    eyebrow: "Offered with your booking",
    title: "Something for the table",
    description:
      "Chosen now, prepared for the evening. These are offered here and nowhere else, so they are yours only if you take them on this screen.",
    onlyNow: "Available only on this screen",
    none: "No, thank you",
    noneHint: "Nothing from this group",
    free: "With our compliments",
    was: "Usually {price}",
    discount: "−{percent}%",
    chosenTitle: "Reserved for your table",
    total: "To settle at the table",
    youSave: "You save {amount}",
    saving: "Saving…",
    saved: "Saved to your booking",
    retry: "Try again",
    error: "We could not save that. Your choice is still on the screen — try again.",
    gone: "That is no longer available. Reload the page to see what is on offer.",
    /** Read out by a screen reader as the group's choices are announced. */
    groupOptions: "Choices in {group}",
  },

  contact: {
    legend: "Contact details",
    why: "In case the restaurant needs to reach you about this reservation.",
    how: "How should we contact you?",
    email: "Email",
    phone: "Phone",
    emailLabel: "Email address",
    phoneLabel: "Phone number",
    phoneHint: "Include the country code, e.g. +359 88 123 4567",
    preferredApp: "Preferred app",
    phoneOrSms: "Phone call or SMS",
    /** Keyed by `contactProblemOf` in lib/contact.ts. */
    problems: {
      missing: "Please leave an email address or a phone number.",
      emailMissing: "Please enter your email address.",
      emailInvalid: "Please enter a valid email address.",
      phoneMissing: "Please enter your phone number.",
      phoneInvalid: "Please enter a valid phone number, including the country code.",
      methodMissing: "Please choose how we should contact you.",
    },
  },

  /** Answers from the server, keyed by the code it sends. See `i18n/errors.ts`. */
  errors: {
    rateLimited: "Too many attempts. Please wait a moment and try again.",
    passKeyInvalid: "That pass-key is not valid. Please check it and try again.",
    passKeyRevoked: "That pass-key is no longer active. Please speak to reception.",
    passKeyUsed: "That pass-key has already been used for every dinner it allows.",
    passKeyExpired: "That pass-key has expired.",
    passKeyAfterStay: "That evening falls after your stay ends. Please choose an earlier date.",
    passKeyTooManyGuests: "Your booking with us is for fewer guests than that. Please speak to reception.",
    dateUnavailable: "Unfortunately, this date is no longer available. Please select another date.",
    dateFull: "Unfortunately, this date is fully booked. Please choose another evening.",
    tableJoinFailed: "We could not seat you with that reservation. Please check the number and try again.",
    changesClosed: "Changes close twelve hours before dinner. Please speak to reception and we will help.",
    notFound: "We could not find a reservation for that pass-key.",
    chooseReservation: "Please say which reservation you mean.",
    invalidRequest: "Please check the details and try again.",
    generic: "Something went wrong. Please try again, or speak to reception.",
  },
} as const;
