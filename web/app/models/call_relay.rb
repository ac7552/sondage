# Servers that help the two computers in an interview find each other.
#
# STUN tells each side its public address. That is often enough, but many home
# routers block direct connections between two homes; then the call goes through
# a TURN relay. The relay only forwards encrypted packets: it can't see or hear
# the call, and it never stores anything.
#
# Relay passwords are short-lived and made fresh for each person, using the
# "shared secret" scheme that the coturn relay server supports
# (use-auth-secret / static-auth-secret): username = "<expiry>:<user id>",
# password = base64(HMAC-SHA1(secret, username)). Nothing is stored here.
#
# Settings (environment variables):
#   STUN_URLS     stun:stun.l.google.com:19302             (comma-separated)
#   TURN_URLS     turn:relay.example.org:3478?transport=udp,turns:relay.example.org:5349?transport=tcp
#   TURN_SECRET   the same secret as static-auth-secret in turnserver.conf
#   TURN_USERNAME / TURN_PASSWORD   a fixed login instead of TURN_SECRET (simple setups)
#   TURN_ONLY=1   always use the relay. Slightly slower, but the two homes never
#                 learn each other's internet address.
class CallRelay
  TTL = 12.hours

  def self.stun_urls = ENV.fetch("STUN_URLS", ENV.fetch("STUN_URL", "stun:stun.l.google.com:19302")).split(",").map(&:strip).reject(&:blank?)
  def self.turn_urls = ENV.fetch("TURN_URLS", ENV["TURN_URL"].to_s).split(",").map(&:strip).reject(&:blank?)
  def self.relay_only? = ActiveModel::Type::Boolean.new.cast(ENV["TURN_ONLY"]) && turn_urls.any?

  # The list handed to RTCPeerConnection, for this person, right now.
  def self.ice_servers_for(user, now: Time.current)
    servers = []
    servers << { urls: stun_urls } if stun_urls.any? && !relay_only?
    if turn_urls.any?
      if ENV["TURN_SECRET"].present?
        username = "#{(now + TTL).to_i}:#{user.id}"
        credential = Base64.strict_encode64(OpenSSL::HMAC.digest("SHA1", ENV["TURN_SECRET"], username))
        servers << { urls: turn_urls, username:, credential: }
      elsif ENV["TURN_USERNAME"].present?
        servers << { urls: turn_urls, username: ENV["TURN_USERNAME"], credential: ENV["TURN_PASSWORD"].to_s }
      end
    end
    servers
  end

  def self.config_for(user) = { ice_servers: ice_servers_for(user), relay_only: relay_only? }
end
