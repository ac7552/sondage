module ApplicationCable
  class Connection < ActionCable::Connection::Base
    identified_by :current_user

    def connect
      self.current_user = from_token || from_cookie || reject_unauthorized_connection
    end

    private

    # The desktop app signs in with its token.
    def from_token
      ApiToken.authenticate(request.params[:token])&.user
    end

    # The historian's browser uses its normal Devise sign-in.
    def from_cookie
      env["warden"]&.user(:user)
    end
  end
end
