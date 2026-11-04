# Sondage's own safety copy, as the desktop app makes it (see desktop/src/core/keys.js):
#
#   unlocking share (33 bytes) || signing share (33 bytes)  — 132 hex characters
#
# The halves come from separate splits, so the unlocking half alone can rebuild only the
# key that opens capsules, never the one that signs them. That is all an heir is given.
module SafetyShare
  HALF_HEX = 66

  def self.splittable?(hex) = hex.to_s.match?(/\A\h{#{HALF_HEX * 2}}\z/)

  # The unlocking half of a copy. Copies made before the split (130 hex) hold both keys
  # together and can't be halved; they are released whole, as before, and the admin page
  # says so.
  def self.unlocking_half(hex)
    return nil if hex.blank?
    splittable?(hex) ? hex[0, HALF_HEX] : hex
  end
end
