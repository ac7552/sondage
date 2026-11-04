class Admin::FellowsController < ApplicationController
  before_action :require_admin

  def new
    @user = User.new(role: "fellow")
    @fellow = Fellow.new
  end

  def create
    attrs = params.require(:user).permit(:name, :email, :password)
    chosen = attrs[:password].presence
    @user = User.new(attrs.merge(role: "fellow", password: chosen || SecureRandom.base58(24)))
    @fellow = Fellow.new(params.require(:fellow).permit(:preferred_name, :birth_year, :birth_place).merge(user: @user, admin: current_user))
    ActiveRecord::Base.transaction do
      @user.save!
      @fellow.save!
      @fellow.ensure_ten_by_ten_lists!
      AuditEvent.record!("fellow.created", actor: current_user, fellow: @fellow, subject: @fellow)
    end
    @user.send_reset_password_instructions unless chosen
    note = chosen ? "Share their password with them in person or by phone." : "We've emailed #{@user.email} a link to choose a password."
    redirect_to fellow_path(@fellow), notice: "#{@fellow.display_name} has been added. #{note}"
  rescue ActiveRecord::RecordInvalid
    render :new, status: :unprocessable_entity
  end
end
